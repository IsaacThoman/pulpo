"""The control helper of a workspace's screen: sees and controls the windows on display :1 for the
agent. The protocol is packages/workspace-daemon/src/control/protocol.ts; `pulpo-desktop helper`
runs this with the system Python and the session's environment.

Windows come from the window manager's EWMH hints, pictures from the X server, input from XTEST
(the X pointer is the agent's pointer, and the screen is the workspace's own, so nothing here has to
stay out of anyone's way), and elements from AT-SPI over D-Bus.

Requests are read on a thread of their own and handled on the main thread, one at a time, in order.
When standard input closes, what is running stops where it is (text being typed stops at once) and
the helper leaves.
"""

import json
import math
import os
import queue
import re
import subprocess
import sys
import threading
import time
import uuid

import gi

gi.require_version('Gio', '2.0')
gi.require_version('GLib', '2.0')
from gi.repository import Gio, GLib  # noqa: E402
from PIL import Image  # noqa: E402
from Xlib import X, XK, display as xdisplay, error as xerror  # noqa: E402
from Xlib.ext import xtest  # noqa: E402
from Xlib.protocol import event as xevent  # noqa: E402

PROTOCOL = 1
MAX_TEXT = 160
# Browsers and long documents have enormous trees; the outline is cut here rather than make the agent wait.
OUTLINE_BUDGET_S = 2.0
# Every node costs a few D-Bus questions; past this many the outline is cut even within the budget.
OUTLINE_MAX_NODES = 6000
DBUS_TIMEOUT_MS = 1500
# Whether the app answers at all, before it is asked for an outline.
PROBE_TIMEOUT_MS = 500
# A window smaller than this is a palette or a tooltip, not something a person works in.
MIN_WINDOW = (60, 40)
# After stdin closes, a request still running gets this long to end by itself.
CLOSING_GRACE_S = 1.0
TYPE_DELAY_MS = 8
INPUT_TYPE_DELAY_MS = 4
# How long a person's keys wait after their own shortcut or click, for the focus it moved to settle.
INPUT_FOCUS_SETTLE_S = 0.08

closing = threading.Event()


class ControlError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def invalid(message):
    return ControlError('invalid_request', message)


def log(message):
    print(f'pulpo-control: {message}', file=sys.stderr, flush=True)


# MARK: Text


def clean(text):
    """Trimmed, on one line, and at most 160 characters; None when nothing is left."""
    if not isinstance(text, str):
        return None
    one_line = ' '.join(text.replace('\ufffc', ' ').split())
    if not one_line:
        return None
    return one_line if len(one_line) <= MAX_TEXT else one_line[:MAX_TEXT - 1] + '…'


def clean_block(text):
    """A text area keeps its line breaks; the agent reads them as the document's."""
    if not isinstance(text, str):
        return None
    trimmed = text.replace('\ufffc', ' ').strip()
    if not trimmed:
        return None
    return trimmed if len(trimmed) <= MAX_TEXT else trimmed[:MAX_TEXT - 1] + '…'


def number_text(number):
    if number == round(number) and abs(number) < 1e15:
        return str(int(number))
    return f'{number:.4g}'


# MARK: Parameters


def require_int(params, name):
    value = params.get(name)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value != int(value):
        raise invalid(f'`{name}` must be a whole number.')
    return int(value)


def optional_int(params, name):
    return None if params.get(name) is None else require_int(params, name)


def require_number(params, name):
    value = params.get(name)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise invalid(f'`{name}` must be a number.')
    return float(value)


def optional_number(params, name):
    return None if params.get(name) is None else require_number(params, name)


def require_string(params, name):
    value = params.get(name)
    if not isinstance(value, str):
        raise invalid(f'`{name}` must be text.')
    return value


# MARK: Keys

# Key names of protocol.ts to X keysym names. `cmd` is the Super key, as it is the Windows key on Windows.
NAMED_KEYS = {
    'enter': 'Return', 'return': 'Return', 'escape': 'Escape', 'esc': 'Escape', 'tab': 'Tab', 'space': 'space',
    'backspace': 'BackSpace', 'delete': 'Delete', 'forwarddelete': 'Delete', 'del': 'Delete',
    'up': 'Up', 'down': 'Down', 'left': 'Left', 'right': 'Right',
    'arrowup': 'Up', 'arrowdown': 'Down', 'arrowleft': 'Left', 'arrowright': 'Right',
    'home': 'Home', 'end': 'End', 'pageup': 'Prior', 'pagedown': 'Next', 'pgup': 'Prior', 'pgdn': 'Next',
    'help': 'Help', 'insert': 'Insert', 'plus': 'plus', 'minus': 'minus',
    **{f'f{number}': f'F{number}' for number in range(1, 21)},
}
MODIFIERS = {
    'cmd': 'Super_L', 'command': 'Super_L', 'meta': 'Super_L', 'super': 'Super_L', 'win': 'Super_L',
    'ctrl': 'Control_L', 'control': 'Control_L', 'alt': 'Alt_L', 'option': 'Alt_L', 'opt': 'Alt_L', 'shift': 'Shift_L',
}
# Chromium reads a new keymap when the server announces one; it needs a moment before the new keys arrive.
KEYMAP_SETTLE_S = 0.05


def character_keysym(character):
    code = ord(character)
    if character == '\n':
        return XK.XK_Return
    if character == '\t':
        return XK.XK_Tab
    if 0x20 <= code <= 0x7e or 0xa0 <= code <= 0xff:
        return code
    return 0x01000000 + code


def parse_keys(keys):
    """`ctrl+shift+t` → (modifier keysyms, the key's keysym)."""
    trimmed = keys.strip()
    if not trimmed:
        raise invalid('`keys` is empty.')
    # `+` joins the parts, so a chord ending in the plus key itself ends in `++`.
    if trimmed == '+':
        parts = ['+']
    elif trimmed.endswith('++'):
        parts = trimmed[:-2].split('+') + ['+']
    else:
        parts = trimmed.split('+')
    parts = [part.strip() for part in parts]
    key = parts.pop()
    if not key or any(not part for part in parts):
        raise invalid(f'`{keys}` is not a key or chord.')
    modifiers = []
    for modifier in parts:
        name = MODIFIERS.get(modifier.lower())
        if not name:
            raise invalid(f'`{modifier}` in `{keys}` is not cmd, ctrl, alt or shift.')
        keysym = XK.string_to_keysym(name)
        if keysym not in modifiers:
            modifiers.append(keysym)
    named = NAMED_KEYS.get(key.lower())
    if named is not None:
        return modifiers, XK.string_to_keysym(named)
    if len(key) != 1:
        raise invalid(f'`{key}` is not a key name or a single character.')
    return modifiers, character_keysym(key)


class Keyboard:
    """
    Keys pressed through XTEST, as a keyboard with the screen's US layout would. A character that
    layout has no key for (é, ✓, 日) is put on a key that has no symbols, a batch at a time, by
    loading a keymap that adds them; the original keymap comes back afterwards. Programs read a new
    keymap when the server announces it, which a change through the core protocol (what xdotool
    does) does not reliably cause in Chromium, so the whole keymap is loaded with xkbcomp.
    """

    def __init__(self, display):
        self.display = display
        first = display.display.info.min_keycode
        mapping = display.get_keyboard_mapping(first, display.display.info.max_keycode - first + 1)
        # keysym → (keycode, needs shift), unshifted keys first.
        self.keys = {}
        for level in (0, 1):
            for offset, symbols in enumerate(mapping):
                if len(symbols) > level and symbols[level]:
                    self.keys.setdefault(symbols[level], (first + offset, level == 1))
        self.shift = self.keys.get(XK.XK_Shift_L, (None,))[0]
        self.base = None
        self.spare = []
        # keysym → keycode, for what the loaded keymap adds.
        self.extra = {}

    def load(self, keymap):
        result = subprocess.run(['xkbcomp', '-w0', '-', os.environ.get('DISPLAY', ':1')], input=keymap.encode(), capture_output=True, timeout=10)
        if result.returncode != 0:
            raise ControlError('failed', f'The keymap could not be loaded: {result.stderr.decode(errors="replace").strip()[:200]}')
        time.sleep(KEYMAP_SETTLE_S)

    def prepare(self, keysyms):
        """Puts these keysyms (as many as there are spare keys) on keys that have none."""
        if self.base is None:
            dumped = subprocess.run(['xkbcomp', '-w0', '-xkb', os.environ.get('DISPLAY', ':1'), '-'], capture_output=True, timeout=10)
            if dumped.returncode != 0:
                raise ControlError('failed', 'The keymap could not be read.')
            self.base = dumped.stdout.decode()
            codes = dict(re.findall(r'^\s*<([A-Za-z0-9_+-]+)>\s*=\s*(\d+);', self.base, re.M))
            used = set(re.findall(r'^\s*key\s+<([A-Za-z0-9_+-]+)>', self.base, re.M))
            used_codes = {code for keysym, (code, _) in self.keys.items()}
            self.spare = sorted(
                ((name, int(code)) for name, code in codes.items() if name not in used and int(code) not in used_codes and 9 <= int(code) <= 255),
                key=lambda item: item[1],
            )
            if not self.spare:
                raise ControlError('unsupported', 'The keyboard has no free key to type characters it lacks.')
        batch = keysyms[:len(self.spare)]
        lines = ''.join(f'    key <{name}> {{ [ 0x{keysym:08x} ] }};\n' for (name, _), keysym in zip(self.spare, batch))
        end = self.base.rfind('};', 0, self.base.find('xkb_geometry') if 'xkb_geometry' in self.base else len(self.base))
        self.load(self.base[:end] + lines + self.base[end:])
        self.extra = {keysym: code for (_, code), keysym in zip(self.spare, batch)}

    def restore(self):
        if self.extra:
            self.extra = {}
            self.load(self.base)

    def tap(self, keycode, modifiers=()):
        held = [code for code in modifiers if code]
        for code in held:
            xtest.fake_input(self.display, X.KeyPress, code)
        xtest.fake_input(self.display, X.KeyPress, keycode)
        xtest.fake_input(self.display, X.KeyRelease, keycode)
        for code in reversed(held):
            xtest.fake_input(self.display, X.KeyRelease, code)
        self.display.sync()

    def place(self, keysyms):
        """Gives these keysyms keys, loading a keymap for those the layout lacks."""
        missing = list(dict.fromkeys(keysym for keysym in keysyms if keysym not in self.keys and keysym not in self.extra))
        if missing:
            self.prepare(missing)

    def type(self, text, delay_ms):
        keysyms = [character_keysym(character) for character in text if character != '\r']
        try:
            for index, keysym in enumerate(keysyms):
                if closing.is_set():
                    raise ControlError('failed', 'The helper is stopping.')
                if keysym not in self.keys and keysym not in self.extra:
                    # The next characters the layout lacks, up to as many as there are spare keys.
                    self.place(keysyms[index:])
                if keysym in self.keys:
                    code, shifted = self.keys[keysym]
                    self.tap(code, [self.shift] if shifted else [])
                else:
                    self.tap(self.extra[keysym])
                time.sleep(delay_ms / 1000)
        finally:
            self.restore()

    def press(self, keys):
        modifiers, keysym = parse_keys(keys)
        held = []
        for modifier in modifiers:
            if modifier in self.keys:
                held.append(self.keys[modifier][0])
        try:
            if keysym in self.keys:
                code, shifted = self.keys[keysym]
                # A character typed with Shift (`ctrl+A`, `!`) holds Shift too.
                if shifted and self.shift not in held:
                    held.append(self.shift)
            else:
                self.place([keysym])
                code = self.extra[keysym]
            self.tap(code, held)
        finally:
            self.restore()


# MARK: The X server


class Screen:
    """The display: its windows as the window manager lists them, their pictures, and XTEST input."""

    def __init__(self):
        self.display = xdisplay.Display()
        self.root = self.display.screen().root
        self.width = self.display.screen().width_in_pixels
        self.height = self.display.screen().height_in_pixels
        self.atoms = {}

    def atom(self, name):
        if name not in self.atoms:
            self.atoms[name] = self.display.intern_atom(name)
        return self.atoms[name]

    def property(self, window, name):
        try:
            prop = window.get_full_property(self.atom(name), X.AnyPropertyType)
        except xerror.XError:
            return None
        return None if prop is None else prop.value

    def window(self, window_id):
        return self.display.create_resource_object('window', window_id)

    def active_window(self):
        value = self.property(self.root, '_NET_ACTIVE_WINDOW')
        return int(value[0]) if value is not None and len(value) else 0

    def stacking(self):
        """Managed windows, front to back."""
        value = self.property(self.root, '_NET_CLIENT_LIST_STACKING')
        if value is None:
            value = self.property(self.root, '_NET_CLIENT_LIST')
        return [int(window_id) for window_id in reversed(value)] if value is not None else []

    def title(self, window):
        value = self.property(window, '_NET_WM_NAME')
        if value is None:
            value = self.property(window, 'WM_NAME')
        if isinstance(value, bytes):
            return value.decode('utf-8', 'replace')
        return value if isinstance(value, str) else ''

    def pid(self, window):
        value = self.property(window, '_NET_WM_PID')
        if value is not None and len(value):
            return int(value[0])
        return None

    def kind(self, window):
        """'normal', 'dialog' or None for a window that is not one a person works in."""
        types = self.property(window, '_NET_WM_WINDOW_TYPE')
        names = {self.atom('_NET_WM_WINDOW_TYPE_NORMAL'): 'normal', self.atom('_NET_WM_WINDOW_TYPE_DIALOG'): 'dialog'}
        if types is None or not len(types):
            return 'normal'
        for value in types:
            if int(value) in names:
                return names[int(value)]
        return None

    def minimized(self, window):
        states = self.property(window, '_NET_WM_STATE')
        return states is not None and self.atom('_NET_WM_STATE_HIDDEN') in [int(state) for state in states]

    def geometry(self, window):
        """The window's rectangle on screen, from the top-left corner: (x, y, width, height)."""
        geometry = window.get_geometry()
        origin = self.root.translate_coords(window, 0, 0)
        return (origin.x, origin.y, geometry.width, geometry.height)

    def app_class(self, window):
        try:
            names = window.get_wm_class()
        except xerror.XError:
            names = None
        if not names:
            return None
        return names[1] or names[0]

    def activate(self, window_id):
        """Raises and focuses the window (and restores it when minimized). True when that changed anything."""
        if self.active_window() == window_id and not self.minimized(self.window(window_id)):
            return False
        message = xevent.ClientMessage(
            window=self.window(window_id), client_type=self.atom('_NET_ACTIVE_WINDOW'),
            data=(32, [2, X.CurrentTime, 0, 0, 0]),
        )
        self.root.send_event(message, event_mask=X.SubstructureRedirectMask | X.SubstructureNotifyMask)
        self.display.flush()
        until = time.monotonic() + 0.5
        while time.monotonic() < until and self.active_window() != window_id:
            time.sleep(0.01)
        return True

    def capture(self, rect):
        x, y, width, height = rect
        image = self.root.get_image(x, y, width, height, X.ZPixmap, 0xFFFFFFFF)
        return Image.frombuffer('RGB', (width, height), image.data, 'raw', 'BGRX', 0, 1)

    # Input

    def pointer(self):
        position = self.root.query_pointer()
        return position.root_x, position.root_y

    def move(self, x, y):
        xtest.fake_input(self.display, X.MotionNotify, x=int(round(x)), y=int(round(y)))
        self.display.sync()

    def glide(self, x, y):
        """Moves the pointer there over a moment, so whoever watches the screen sees where the agent is about to act."""
        start_x, start_y = self.pointer()
        steps = 6
        for step in range(1, steps + 1):
            self.move(start_x + (x - start_x) * step / steps, start_y + (y - start_y) * step / steps)
            time.sleep(0.012)

    def button(self, button, down):
        xtest.fake_input(self.display, X.ButtonPress if down else X.ButtonRelease, button)
        self.display.sync()

    def click(self, button, count):
        for index in range(count):
            if index:
                time.sleep(0.04)
            self.button(button, True)
            time.sleep(0.01)
            self.button(button, False)

    def wheel(self, dx, dy):
        """One notch per line; positive `dy` moves down the page, positive `dx` to the right."""
        for amount, back, forward in ((dy, 4, 5), (dx, 6, 7)):
            for _ in range(abs(amount)):
                if closing.is_set():
                    return
                self.button(forward if amount > 0 else back, True)
                self.button(forward if amount > 0 else back, False)
                time.sleep(0.005)


BUTTONS = {'left': 1, 'middle': 2, 'right': 3}


# MARK: AT-SPI

ACCESSIBLE = 'org.a11y.atspi.Accessible'
PROPERTIES = 'org.freedesktop.DBus.Properties'
REGISTRY = ('org.a11y.atspi.Registry', '/org/a11y/atspi/accessible/root')

STATE_ENABLED, STATE_CHECKED, STATE_DEFUNCT, STATE_EDITABLE = 8, 4, 6, 7
STATE_FOCUSED, STATE_MULTI_LINE, STATE_SENSITIVE, STATE_SHOWING = 12, 17, 24, 25
STATE_INDETERMINATE = 32
MATCH_ALL = 1
SORT_CANONICAL = 1

# The words protocol.ts shares between systems; other roles are their AT-SPI name without spaces.
ROLE_NAMES = {
    'push button': 'button', 'toggle button': 'button', 'button': 'button', 'push button menu': 'menubutton',
    'check box': 'checkbox', 'switch': 'checkbox', 'radio button': 'radio',
    'entry': 'textfield', 'password text': 'textfield', 'editbar': 'textfield', 'spin button': 'stepper',
    'link': 'link', 'static': 'text', 'label': 'text', 'caption': 'text', 'heading': 'heading',
    'menu': 'menu', 'popup menu': 'menu', 'menu bar': 'menubar', 'menu item': 'menuitem',
    'check menu item': 'menuitem', 'radio menu item': 'menuitem', 'tearoff menu item': 'menuitem',
    'combo box': 'combobox', 'list box': 'list', 'list': 'list', 'list item': 'listitem',
    'table': 'table', 'table row': 'row', 'table cell': 'cell', 'table column header': 'cell', 'table row header': 'cell',
    'column header': 'cell', 'row header': 'cell', 'tree': 'tree', 'tree table': 'tree', 'tree item': 'row',
    'page tab': 'tab', 'page tab list': 'tablist', 'slider': 'slider', 'image': 'image', 'icon': 'image',
    'tool bar': 'toolbar', 'scroll pane': 'scrollarea', 'viewport': 'scrollarea',
    'document web': 'document', 'document frame': 'document', 'document text': 'document',
    'frame': 'window', 'window': 'window', 'dialog': 'dialog', 'file chooser': 'dialog', 'alert': 'alert',
    'progress bar': 'progressbar', 'level bar': 'slider', 'status bar': 'status', 'tool tip': 'tooltip',
    'split pane': 'splitter', 'panel': 'group', 'section': 'group', 'filler': 'group', 'grouping': 'group',
    'form': 'group', 'landmark': 'group', 'article': 'group', 'block quote': 'group', 'header': 'group',
    'footer': 'group', 'paragraph': 'group', 'embedded': 'group', 'internal frame': 'group',
    'layered pane': 'group', 'root pane': 'group', 'glass pane': 'group', 'option pane': 'group',
    'unknown': 'unknown', 'invalid': 'unknown', 'redundant object': 'unknown', 'application': 'unknown',
}
# Things a person uses, listed even without a label: the agent can still see where they are.
INTERACTIVE_ROLES = {
    'button', 'checkbox', 'radio', 'textfield', 'textarea', 'link', 'menuitem', 'menubutton', 'combobox',
    'slider', 'stepper', 'tab', 'row',
}
# Neither listed nor walked: their content is noise (scroll bar parts) or a line.
SKIPPED_ROLES = {'scroll bar', 'separator'}
# Whatever lies outside these cannot be seen through them.
CLIPPING_ROLES = {'scrollarea', 'document'}
CHECKABLE_ROLES = {'checkbox', 'radio'}
TEXT_ROLES = {'textfield', 'textarea', 'combobox'}


class Busy(Exception):
    """The app did not answer in time: it is busy (still working out an earlier outline, say)."""


def timed_out(error):
    return error.matches(Gio.io_error_quark(), Gio.IOErrorEnum.TIMED_OUT) or 'NoReply' in (error.message or '')


def has_state(states, state):
    word, bit = divmod(state, 32)
    return states is not None and len(states) > word and bool(states[word] & (1 << bit))


def intersect(a, b):
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[0] + a[2], b[0] + b[2]), min(a[1] + a[3], b[1] + b[3])
    if x2 <= x1 or y2 <= y1:
        return None
    return (x1, y1, x2 - x1, y2 - y1)


class Batch:
    """
    D-Bus questions sent together and answered as they come, so an outline waits about as long as
    the app takes to answer them all rather than a round trip per question (every AT-SPI property
    is one).
    """

    def __init__(self, connection, deadline):
        self.connection = connection
        self.deadline = deadline
        self.pending = 0
        self.cancellable = Gio.Cancellable()
        self.context = GLib.MainContext.default()

    def call(self, ref, interface, method, args, reply, done):
        self.pending += 1

        def finished(connection, result, _data):
            self.pending -= 1
            try:
                value = connection.call_finish(result).unpack()
            except GLib.Error:
                value = None
            done(value)

        self.connection.call(
            ref[0], ref[1], interface, method, args, GLib.VariantType(reply) if reply else None,
            Gio.DBusCallFlags.NO_AUTO_START, DBUS_TIMEOUT_MS, self.cancellable, finished, None,
        )

    def wait(self):
        """True when every answer came before the deadline; the rest are given up on."""
        late = [False]

        def expire():
            late[0] = True
            return False

        remaining = self.deadline - time.monotonic()
        if self.pending and remaining > 0:
            source = GLib.timeout_source_new(max(1, int(remaining * 1000)))
            source.set_callback(expire)
            source.attach(self.context)
            while self.pending and not late[0] and not closing.is_set():
                self.context.iteration(True)
            source.destroy()
        if self.pending:
            self.cancellable.cancel()
            while self.pending:
                self.context.iteration(True)
            return False
        return True


class Node:
    __slots__ = ('ref', 'parent', 'states', 'role_name', 'name', 'description', 'interfaces', 'extents', 'children', 'text', 'number')

    def __init__(self, ref):
        self.ref = ref
        self.parent = None
        self.states = None
        self.role_name = None
        self.name = None
        self.description = None
        self.interfaces = ()
        self.extents = None
        self.children = ()
        self.text = None
        self.number = None


class Accessibility:
    def __init__(self):
        self.connection = None
        self.pids = {}

    def bus(self):
        if self.connection is not None and not self.connection.is_closed():
            return self.connection
        session = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        address = session.call_sync(
            'org.a11y.Bus', '/org/a11y/bus', 'org.a11y.Bus', 'GetAddress', None, GLib.VariantType('(s)'),
            Gio.DBusCallFlags.NONE, DBUS_TIMEOUT_MS, None,
        ).unpack()[0]
        self.connection = Gio.DBusConnection.new_for_address_sync(
            address, Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION, None, None,
        )
        self.pids = {}
        return self.connection

    def call(self, ref, interface, method, args=None, reply=None, timeout=DBUS_TIMEOUT_MS):
        result = self.bus().call_sync(
            ref[0], ref[1], interface, method, args, GLib.VariantType(reply) if reply else None,
            Gio.DBusCallFlags.NO_AUTO_START, timeout, None,
        )
        return result.unpack() if result is not None else None

    def app_for(self, pid):
        """The app's root accessible, or None when the process exposes no accessibility tree."""
        try:
            apps = self.call(REGISTRY, ACCESSIBLE, 'GetChildren', reply='(a(so))')[0]
        except GLib.Error:
            self.connection = None
            return None
        for ref in apps:
            name = ref[0]
            if name not in self.pids:
                try:
                    self.pids[name] = self.call(
                        ('org.freedesktop.DBus', '/org/freedesktop/DBus'), 'org.freedesktop.DBus',
                        'GetConnectionUnixProcessID', GLib.Variant('(s)', (name,)), '(u)',
                    )[0]
                except GLib.Error:
                    self.pids[name] = None
            if self.pids[name] == pid:
                return tuple(ref)
        return None

    def frame_for(self, pid, title, rect):
        """
        The accessible window that is this X window: the same title, else the one that covers it most.
        Raises Busy when the app does not answer, so no outline is asked of an app that cannot give one.
        """
        app = self.app_for(pid)
        if app is None:
            return None
        try:
            frames = self.call(app, ACCESSIBLE, 'GetChildren', reply='(a(so))', timeout=PROBE_TIMEOUT_MS)[0]
        except GLib.Error as error:
            if timed_out(error):
                raise Busy() from error
            return None
        best, best_score = None, 0
        for ref in frames:
            ref = tuple(ref)
            try:
                name = self.call(ref, PROPERTIES, 'Get', GLib.Variant('(ss)', (ACCESSIBLE, 'Name')), '(v)', timeout=PROBE_TIMEOUT_MS)[0]
                extents = self.call(ref, 'org.a11y.atspi.Component', 'GetExtents', GLib.Variant('(u)', (0,)), '((iiii))', timeout=PROBE_TIMEOUT_MS)[0]
            except GLib.Error as error:
                if timed_out(error):
                    raise Busy() from error
                continue
            overlap = intersect(extents, rect)
            score = (overlap[2] * overlap[3] if overlap else 0) + (10 ** 9 if name == title else 0)
            if score > best_score:
                best, best_score = ref, score
        return best

    def showing(self, frame, limit, deadline):
        """
        Everything of the window that is showing, in tree order, in one question: the app answers
        it from its own memory (AT-SPI's Collection). Chromium marks a box that is off screen as not
        showing even when what it holds is on screen, so a walk cannot stop at such a box; this asks
        for the showing ones wherever they are. None when the app cannot answer it; an empty list
        when it did not answer before the deadline.
        """
        rule = ([1 << STATE_SHOWING, 0], MATCH_ALL, {}, MATCH_ALL, [], MATCH_ALL, [], MATCH_ALL, False)
        timeout = max(100, int((deadline - time.monotonic()) * 1000))
        try:
            matches = self.call(
                frame, 'org.a11y.atspi.Collection', 'GetMatches',
                GLib.Variant('((aiia{ss}iaiiasib)uib)', (rule, SORT_CANONICAL, limit, True)), '(a(so))', timeout=timeout,
            )[0]
        except GLib.Error as error:
            return [] if timed_out(error) else None
        return [tuple(ref) for ref in matches]

    def describe_nodes(self, nodes, deadline, children=False):
        """Fills in what the outline needs to know of each node; False when the deadline cut it short."""
        connection = self.bus()
        batch = Batch(connection, deadline)
        for node in nodes:
            def described(value, node=node):
                if value:
                    node.name = value[0].get('Name')
                    node.description = value[0].get('Description')
                    parent = value[0].get('Parent')
                    node.parent = tuple(parent) if parent else None
            batch.call(node.ref, ACCESSIBLE, 'GetState', None, '(au)', lambda value, node=node: setattr(node, 'states', value[0] if value else None))
            batch.call(node.ref, ACCESSIBLE, 'GetRoleName', None, '(s)', lambda value, node=node: setattr(node, 'role_name', value[0] if value else None))
            batch.call(node.ref, PROPERTIES, 'GetAll', GLib.Variant('(s)', (ACCESSIBLE,)), '(a{sv})', described)
            batch.call(node.ref, ACCESSIBLE, 'GetInterfaces', None, '(as)', lambda value, node=node: setattr(node, 'interfaces', value[0] if value else ()))
            batch.call(node.ref, 'org.a11y.atspi.Component', 'GetExtents', GLib.Variant('(u)', (0,)), '((iiii))', lambda value, node=node: setattr(node, 'extents', value[0] if value else None))
            if children:
                batch.call(node.ref, ACCESSIBLE, 'GetChildren', None, '(a(so))', lambda value, node=node: setattr(node, 'children', [tuple(ref) for ref in value[0]] if value else ()))
        complete = batch.wait()

        # What a field holds, and a slider's number.
        batch = Batch(connection, deadline)
        for node in nodes:
            if node.role_name is None:
                continue
            role = node_role(node)
            if role in TEXT_ROLES and 'org.a11y.atspi.Text' in node.interfaces:
                batch.call(node.ref, 'org.a11y.atspi.Text', 'GetText', GLib.Variant('(ii)', (0, -1)), '(s)', lambda value, node=node: setattr(node, 'text', value[0] if value else None))
            if 'org.a11y.atspi.Value' in node.interfaces:
                batch.call(node.ref, PROPERTIES, 'Get', GLib.Variant('(ss)', ('org.a11y.atspi.Value', 'CurrentValue')), '(v)', lambda value, node=node: setattr(node, 'number', value[0] if value else None))
        return batch.wait() and complete

    def walk_tree(self, frame, window_rect, deadline):
        """
        For apps that cannot answer `showing`: the tree level by level, every level's questions sent
        together. What is not showing is neither listed nor walked, which holds for toolkits whose
        boxes contain what they hold.
        """
        connection = self.bus()
        truncated = False
        seen = {frame}
        try:
            level = [Node(tuple(ref)) for ref in self.call(frame, ACCESSIBLE, 'GetChildren', reply='(a(so))')[0]]
        except GLib.Error:
            return [], False
        for node in level:
            node.parent = frame
            seen.add(node.ref)
        found = []
        while level:
            if time.monotonic() >= deadline or closing.is_set():
                truncated = True
                break
            batch = Batch(connection, deadline)
            for node in level:
                batch.call(node.ref, ACCESSIBLE, 'GetState', None, '(au)', lambda value, node=node: setattr(node, 'states', value[0] if value else None))
            truncated |= not batch.wait()
            shown = [node for node in level if has_state(node.states, STATE_SHOWING) and not has_state(node.states, STATE_DEFUNCT)]
            truncated |= not self.describe_nodes(shown, deadline, children=True)
            found.extend(shown)
            next_level = []
            for node in shown:
                if node.role_name in SKIPPED_ROLES or (node.extents and intersect(node.extents, window_rect) is None and node.extents[2] > 0):
                    continue
                for ref in node.children:
                    # The same element can turn up twice; walking it twice could loop forever.
                    if ref in seen:
                        continue
                    seen.add(ref)
                    child = Node(ref)
                    child.parent = node.ref
                    next_level.append(child)
            if len(found) + len(next_level) > OUTLINE_MAX_NODES:
                truncated = True
                break
            level = next_level
        # Tree order, which the level-by-level walk lost.
        by_parent = {}
        for node in found:
            by_parent.setdefault(node.parent, []).append(node)
        ordered, stack = [], list(reversed(by_parent.get(frame, [])))
        while stack:
            node = stack.pop()
            ordered.append(node)
            stack.extend(reversed(by_parent.get(node.ref, [])))
        return ordered, truncated

    def walk(self, frame, window_rect, origin, factor, max_elements, deadline):
        """The window's elements, depth-first, with boxes in the picture's pixels; their refs; and whether the list was cut."""
        # Showing boxes outnumber listed elements a few times over; asking for no more lets the app stop early.
        limit = min(OUTLINE_MAX_NODES, max(1000, max_elements * 4))
        refs = self.showing(frame, limit, deadline)
        if refs is None:
            nodes, truncated = self.walk_tree(frame, window_rect, deadline)
        else:
            # An empty answer is a window with nothing showing in it, or an app that ran out of time.
            truncated = len(refs) >= limit or (not refs and time.monotonic() >= deadline - 0.05)
            nodes = [Node(ref) for ref in refs]
            truncated |= not self.describe_nodes(nodes, deadline)
            self.connect_parents(nodes, frame, deadline)
        return self.flatten(nodes, frame, window_rect, origin, factor, max_elements, truncated)

    def connect_parents(self, nodes, frame, deadline):
        """
        Points each node at its nearest ancestor among `nodes`. The parent of a showing node can be a
        box that is not showing (and so is not among them); those are asked for their own parent
        until the chain reaches one that is.
        """
        known = {node.ref for node in nodes} | {frame}
        parents = {}
        unknown = {node.parent for node in nodes if node.parent and node.parent not in known}
        for _ in range(30):
            if not unknown or time.monotonic() >= deadline:
                break
            batch = Batch(self.bus(), deadline)
            for ref in unknown:
                batch.call(ref, PROPERTIES, 'Get', GLib.Variant('(ss)', (ACCESSIBLE, 'Parent')), '(v)', lambda value, ref=ref: parents.__setitem__(ref, tuple(value[0]) if value else None))
            batch.wait()
            unknown = {parent for parent in (parents.get(ref) for ref in unknown) if parent and parent not in known and parent not in parents}
        for node in nodes:
            parent, hops = node.parent, 0
            while parent is not None and parent not in known and hops < 60:
                parent, hops = parents.get(parent), hops + 1
            node.parent = parent if parent in known else frame

    def flatten(self, nodes, frame, window_rect, origin, factor, max_elements, truncated):
        elements, refs = [], []
        # ref → (depth of its nearest listed ancestor or itself, that one's label, clip for what it holds, skipped)
        context = {frame: (-1, None, window_rect, False)}
        for node in nodes:
            parent_depth, parent_label, clip, skipped = context.get(node.parent, context[frame])
            if node.states is None or node.role_name is None:
                # Not described before the deadline: passed over, but what it holds may still be listed.
                context[node.ref] = (parent_depth, parent_label, clip, skipped)
                continue
            if skipped or node.role_name in SKIPPED_ROLES:
                context[node.ref] = (parent_depth, parent_label, clip, True)
                continue
            role = node_role(node)
            label = (clean(node.name) or clean(node.description)) if role != 'text' else clean(node.name)
            value = None
            if role in CHECKABLE_ROLES:
                value = 'mixed' if has_state(node.states, STATE_INDETERMINATE) else 'checked' if has_state(node.states, STATE_CHECKED) else 'unchecked'
            elif role == 'textarea':
                value = clean_block(node.text)
            elif role in TEXT_ROLES:
                value = clean(node.text)
            elif isinstance(node.number, (int, float)) and not isinstance(node.number, bool):
                value = number_text(float(node.number))
            visible = None
            extents = node.extents
            if extents and extents[2] > 0 and extents[3] > 0:
                visible = intersect(extents, clip)
                if role in CLIPPING_ROLES:
                    clip = intersect(clip, extents) or (0, 0, 0, 0)
            listed = (
                visible is not None and role != 'unknown'
                and (role in INTERACTIVE_ROLES or label is not None or value is not None)
                # A link's or a heading's words (or its picture's name) are its name already.
                and not (role in ('text', 'image', 'group') and label is not None and label == parent_label)
            )
            depth = parent_depth
            if listed:
                if len(elements) >= max_elements:
                    truncated = True
                    break
                depth = parent_depth + 1
                x, y, width, height = visible
                element = {
                    'index': len(elements) + 1,
                    'depth': depth,
                    'role': role,
                    'x': int(round((x - origin[0]) * factor)),
                    'y': int(round((y - origin[1]) * factor)),
                    'width': max(1, int(round(width * factor))),
                    'height': max(1, int(round(height * factor))),
                }
                if label is not None:
                    element['label'] = label
                if value is not None and value != label:
                    element['value'] = value
                if has_state(node.states, STATE_FOCUSED):
                    element['focused'] = True
                if role in INTERACTIVE_ROLES and not (has_state(node.states, STATE_ENABLED) or has_state(node.states, STATE_SENSITIVE)):
                    element['enabled'] = False
                elements.append(element)
                refs.append(node.ref)
            context[node.ref] = (depth, label if listed else parent_label, clip, False)
        return elements, refs, truncated

    def alive(self, ref):
        try:
            states = self.call(ref, ACCESSIBLE, 'GetState', reply='(au)')[0]
        except GLib.Error:
            return False
        return not has_state(states, STATE_DEFUNCT)

    def extents(self, ref):
        try:
            return self.call(ref, 'org.a11y.atspi.Component', 'GetExtents', GLib.Variant('(u)', (0,)), '((iiii))')[0]
        except GLib.Error:
            return None

    def interfaces(self, ref):
        try:
            return self.call(ref, ACCESSIBLE, 'GetInterfaces', reply='(as)')[0]
        except GLib.Error:
            return []

    def describe(self, ref):
        """`the "Search" textfield`, for notes."""
        try:
            name = clean(self.call(ref, PROPERTIES, 'Get', GLib.Variant('(ss)', (ACCESSIBLE, 'Name')), '(v)')[0])
            role = self.call(ref, ACCESSIBLE, 'GetRoleName', reply='(s)')[0]
        except GLib.Error:
            return 'the element'
        return f'the "{name}" {role}' if name else f'the {role}'


def node_role(node):
    name = (node.role_name or '').replace('-', ' ').lower()
    role = ROLE_NAMES.get(name) or name.replace(' ', '') or 'unknown'
    multi_line = has_state(node.states, STATE_MULTI_LINE)
    if role == 'textfield' and multi_line:
        return 'textarea'
    if name == 'text':
        if has_state(node.states, STATE_EDITABLE):
            return 'textarea' if multi_line else 'textfield'
        return 'text'
    return role


# MARK: Requests


class Helper:
    def __init__(self):
        self.screen = Screen()
        self.keyboard = Keyboard(self.screen.display)
        self.a11y = Accessibility()
        self.exclude = set()
        self.image_dir = None
        self.max_edge = 1280
        self.counter = 0
        # window id → what its latest snapshot showed: pid, origin, factor, image size, element refs.
        self.snapshots = {}

    def configure(self, params):
        pids = params.get('excludePids')
        if not isinstance(pids, list) or not all(isinstance(pid, int) and not isinstance(pid, bool) for pid in pids):
            raise invalid('`excludePids` must be a list of process ids.')
        image_dir = require_string(params, 'imageDir')
        max_edge = require_number(params, 'maxImageEdge')
        if max_edge < 16:
            raise invalid('`maxImageEdge` must be at least 16.')
        if not os.path.isdir(image_dir):
            raise invalid('`imageDir` is not a folder.')
        self.exclude = set(pids)
        self.image_dir = image_dir
        self.max_edge = max_edge
        return {'protocol': PROTOCOL, 'platform': 'linux', 'background': True}

    # Windows

    def windows(self):
        """Ordinary windows and dialogs that a person can see, front to back, as (id, pid, class, kind)."""
        listed = []
        for window_id in self.screen.stacking():
            window = self.screen.window(window_id)
            try:
                kind = self.screen.kind(window)
                if kind is None:
                    continue
                pid = self.screen.pid(window)
                if pid is None or pid in self.exclude:
                    continue
                _, _, width, height = self.screen.geometry(window)
                if width < MIN_WINDOW[0] or height < MIN_WINDOW[1]:
                    continue
                listed.append((window_id, pid, self.screen.app_class(window), kind))
            except xerror.XError:
                continue
        return listed

    def apps(self, _params):
        active = self.screen.active_window()
        apps, order = {}, []
        for window_id, pid, app_class, _kind in self.windows():
            window = self.screen.window(window_id)
            if pid not in apps:
                name = app_class or f'process {pid}'
                apps[pid] = {
                    'id': (app_class or str(pid)).lower(),
                    'name': name[:1].upper() + name[1:] if name.islower() else name,
                    'pid': pid,
                    'frontmost': False,
                    'windows': [],
                }
                order.append(pid)
            if window_id == active:
                apps[pid]['frontmost'] = True
            apps[pid]['windows'].append({'id': window_id, 'title': self.screen.title(window), 'minimized': self.screen.minimized(window)})
        frontmost = [pid for pid in order if apps[pid]['frontmost']]
        return {'apps': [apps[pid] for pid in frontmost + [pid for pid in order if pid not in frontmost]]}

    def target(self, params):
        pid = require_int(params, 'pid')
        window_id = require_int(params, 'windowId')
        if pid <= 0 or window_id <= 0:
            raise invalid('`pid` and `windowId` must name a process and one of its windows.')
        if pid in self.exclude:
            raise ControlError('not_found', 'No such app.')
        if window_id not in self.screen.stacking():
            raise ControlError('not_found', 'The window is gone.')
        window = self.screen.window(window_id)
        try:
            if self.screen.pid(window) != pid:
                raise ControlError('not_found', 'The window is gone.')
        except xerror.XError:
            raise ControlError('not_found', 'The window is gone.')
        return window_id, pid

    def rect(self, window_id):
        """The part of the window that is on the screen."""
        try:
            rect = self.screen.geometry(self.screen.window(window_id))
        except xerror.XError:
            raise ControlError('not_found', 'The window is gone.')
        visible = intersect(rect, (0, 0, self.screen.width, self.screen.height))
        if visible is None:
            raise ControlError('unsupported', 'The window is off the screen.')
        return visible

    # Snapshot

    def snapshot(self, params):
        if self.image_dir is None:
            raise invalid('`configure` must name an `imageDir` first.')
        window_id, pid = self.target(params)
        outline = params.get('outline', True) is not False
        max_elements = max(1, min(optional_int(params, 'maxElements') or 300, 5000))
        if self.screen.activate(window_id):
            # The app repaints what was covered once it is in front.
            time.sleep(0.15)
        rect = self.rect(window_id)
        window = self.screen.window(window_id)
        title = self.screen.title(window)

        # The window's rectangle as the screen shows it, so menus and pop-ups drawn over it are in the picture.
        picture = self.screen.capture(rect)
        factor = min(1.0, self.max_edge / max(rect[2], rect[3]))
        width = max(1, int(round(rect[2] * factor)))
        height = max(1, int(round(rect[3] * factor)))
        if (width, height) != picture.size:
            picture = picture.resize((width, height), Image.LANCZOS)
        self.counter += 1
        path = os.path.join(self.image_dir, f'window-{window_id}-{os.getpid()}-{self.counter}-{uuid.uuid4().hex[:8]}.jpg')
        picture.save(path, 'JPEG', quality=80)
        factor = width / rect[2]

        elements, refs, truncated = [], [], False
        if outline:
            deadline = time.monotonic() + OUTLINE_BUDGET_S
            try:
                frame = self.a11y.frame_for(pid, title, rect)
                if frame is not None:
                    elements, refs, truncated = self.a11y.walk(frame, rect, rect[:2], factor, max_elements, deadline)
            except Busy:
                log(f'the app of window {window_id} did not answer accessibility questions in time')
                truncated = True
            except GLib.Error as error:
                # An app without an accessibility tree, or a bus that went away, has no elements; the picture still counts.
                log(f'outline of window {window_id} failed: {error.message}')
                self.a11y.connection = None
        self.snapshots[window_id] = {'pid': pid, 'factor': factor, 'width': width, 'height': height, 'refs': refs}
        return {
            'window': {'id': window_id, 'title': title, 'minimized': False},
            'image': {'path': path, 'width': width, 'height': height, 'mimeType': 'image/jpeg'},
            'elements': elements,
            'truncated': truncated,
        }

    # Act

    def pictured(self, window_id, pid):
        snapshot = self.snapshots.get(window_id)
        if snapshot is None or snapshot['pid'] != pid:
            raise invalid('Take a snapshot of the window first; coordinates are pixels of its image.')
        return snapshot

    def point(self, window_id, pid, x, y):
        """A pixel of the latest snapshot as a point on the screen, from where the window is now."""
        snapshot = self.pictured(window_id, pid)
        if not (0 <= x <= snapshot['width'] and 0 <= y <= snapshot['height']):
            raise invalid(f'({int(x)}, {int(y)}) is outside the window\'s {snapshot["width"]}×{snapshot["height"]} image.')
        rect = self.rect(window_id)
        return (
            min(rect[0] + rect[2] - 1, rect[0] + x / snapshot['factor']),
            min(rect[1] + rect[3] - 1, rect[1] + y / snapshot['factor']),
        )

    def element(self, window_id, pid, index):
        snapshot = self.pictured(window_id, pid)
        if index < 1 or index > len(snapshot['refs']):
            raise ControlError('stale_element', f'Element {index} is not in the window\'s latest snapshot.')
        ref = snapshot['refs'][index - 1]
        if not self.a11y.alive(ref):
            raise ControlError('stale_element', f'Element {index} is gone; take a new snapshot.')
        return ref

    def middle(self, window_id, ref):
        """The visible middle of an element, as a point on the screen."""
        extents = self.a11y.extents(ref)
        if not extents or extents[2] <= 0 or extents[3] <= 0:
            raise ControlError('unsupported', 'The element has no place on screen to act at.')
        visible = intersect(extents, self.rect(window_id))
        if visible is None:
            raise ControlError('unsupported', 'The element is outside the window; scroll it into view first.')
        return (visible[0] + visible[2] / 2, visible[1] + visible[3] / 2)

    def act(self, params):
        window_id, pid = self.target(params)
        action = params.get('action')
        if not isinstance(action, dict) or not isinstance(action.get('type'), str):
            raise invalid('`action` must be an object with a `type`.')
        kind = action['type']
        handler = {
            'click': self.click, 'type': self.type, 'key': self.key, 'scroll': self.scroll,
            'drag': self.drag, 'set_value': self.set_value,
        }.get(kind)
        if handler is None:
            raise invalid(f'`{kind}` is not an action.')
        # Input goes to whatever is in front, so the window is brought there first.
        if self.screen.activate(window_id):
            time.sleep(0.1)
        note = handler(window_id, pid, action)
        return {'note': note} if note else {}

    def click(self, window_id, pid, action):
        button = BUTTONS.get(action.get('button', 'left'))
        if button is None:
            raise invalid('`button` must be left, right or middle.')
        count = optional_int(action, 'count') or 1
        if count not in (1, 2, 3):
            raise invalid('`count` must be 1, 2 or 3.')
        index = optional_int(action, 'element')
        if index is not None:
            ref = self.element(window_id, pid, index)
            try:
                point = self.middle(window_id, ref)
            except ControlError:
                # No place to click at: the element's own action still works when it has one.
                if count == 1 and button == 1 and 'org.a11y.atspi.Action' in self.a11y.interfaces(ref):
                    try:
                        if self.a11y.call(ref, 'org.a11y.atspi.Action', 'DoAction', GLib.Variant('(i)', (0,)), '(b)')[0]:
                            return f'Pressed {self.a11y.describe(ref)}.'
                    except GLib.Error:
                        pass
                raise
        else:
            x, y = optional_number(action, 'x'), optional_number(action, 'y')
            if x is None or y is None:
                raise invalid('A click needs `element` or `x` and `y`.')
            point = self.point(window_id, pid, x, y)
        self.screen.glide(*point)
        self.screen.click(button, count)
        return None

    def type(self, _window_id, _pid, action):
        self.keyboard.type(require_string(action, 'text'), TYPE_DELAY_MS)
        return None

    def key(self, _window_id, _pid, action):
        self.keyboard.press(require_string(action, 'keys'))
        return None

    def scroll(self, window_id, pid, action):
        dx, dy = optional_int(action, 'dx') or 0, optional_int(action, 'dy') or 0
        if abs(dx) > 200 or abs(dy) > 200:
            raise invalid('`dx` and `dy` are lines, at most 200.')
        index = optional_int(action, 'element')
        if index is not None:
            point = self.middle(window_id, self.element(window_id, pid, index))
        elif action.get('x') is not None and action.get('y') is not None:
            point = self.point(window_id, pid, require_number(action, 'x'), require_number(action, 'y'))
        else:
            rect = self.rect(window_id)
            point = (rect[0] + rect[2] / 2, rect[1] + rect[3] / 2)
        self.screen.glide(*point)
        self.screen.wheel(dx, dy)
        return None

    def drag(self, window_id, pid, action):
        start = self.point(window_id, pid, require_number(action, 'fromX'), require_number(action, 'fromY'))
        end = self.point(window_id, pid, require_number(action, 'toX'), require_number(action, 'toY'))
        self.screen.glide(*start)
        self.screen.button(1, True)
        try:
            # In steps, so the app sees the pointer move with the button held (drag and drop needs that).
            steps = 12
            for step in range(1, steps + 1):
                if closing.is_set():
                    break
                time.sleep(0.02)
                self.screen.move(start[0] + (end[0] - start[0]) * step / steps, start[1] + (end[1] - start[1]) * step / steps)
            time.sleep(0.05)
        finally:
            self.screen.button(1, False)
        return None

    def set_value(self, window_id, pid, action):
        index = require_int(action, 'element')
        text = require_string(action, 'value')
        ref = self.element(window_id, pid, index)
        interfaces = self.a11y.interfaces(ref)
        name = self.a11y.describe(ref)
        try:
            if 'org.a11y.atspi.EditableText' in interfaces:
                if not self.a11y.call(ref, 'org.a11y.atspi.EditableText', 'SetTextContents', GLib.Variant('(s)', (text,)), '(b)')[0]:
                    raise ControlError('failed', 'The app did not accept the new value.')
                return f'Set {name} to "{clean(text) or ""}".'
            if 'org.a11y.atspi.Value' in interfaces:
                try:
                    number = float(text.strip())
                except ValueError:
                    raise invalid(f'Element {index} holds a number; `{text}` is not one.')
                self.a11y.call(ref, PROPERTIES, 'Set', GLib.Variant('(ssv)', ('org.a11y.atspi.Value', 'CurrentValue', GLib.Variant('d', number))))
                return f'Set {name} to {number_text(number)}.'
            role = self.a11y.call(ref, ACCESSIBLE, 'GetRoleName', reply='(s)')[0]
            states = self.a11y.call(ref, ACCESSIBLE, 'GetState', reply='(au)')[0]
        except GLib.Error as error:
            raise ControlError('failed', f'The app did not accept the new value: {error.message}')
        # Chromium's fields have no interface to set their text: the field gets the keyboard focus, its
        # text is selected, and the new text typed over it.
        if role in ('entry', 'password text', 'text', 'combo box') and has_state(states, STATE_EDITABLE):
            try:
                focused = self.a11y.call(ref, 'org.a11y.atspi.Component', 'GrabFocus', reply='(b)')[0]
            except GLib.Error:
                focused = False
            if not focused:
                self.screen.glide(*self.middle(window_id, ref))
                self.screen.click(1, 1)
            time.sleep(0.05)
            self.keyboard.press('ctrl+a')
            if text:
                self.keyboard.type(text, TYPE_DELAY_MS)
            else:
                self.keyboard.press('backspace')
            return f'Replaced the text of {name} with "{clean(text) or ""}" by typing it.'
        raise ControlError('unsupported', f'Element {index}\'s value cannot be set; click it and type instead.')

    # A person in control

    def input(self, params):
        events = params.get('events')
        if not isinstance(events, list):
            raise invalid('`events` must be a list.')
        previous = None
        for event in events:
            if closing.is_set():
                break
            if not isinstance(event, dict):
                raise invalid('Each event must be an object.')
            kind = event.get('type')
            # A shortcut or a click moves the keyboard focus a moment later (Ctrl+L to the address
            # bar, a click into a field). Keys sent in the same batch would land before it has.
            if kind in ('text', 'key') and previous in ('key', 'click', 'up'):
                time.sleep(INPUT_FOCUS_SETTLE_S)
            previous = kind
            if kind in ('move', 'down', 'up', 'click', 'scroll'):
                x = min(max(require_number(event, 'x'), 0), self.screen.width - 1)
                y = min(max(require_number(event, 'y'), 0), self.screen.height - 1)
                self.screen.move(x, y)
                if kind in ('down', 'up', 'click'):
                    button = BUTTONS.get(event.get('button', 'left'))
                    if button is None:
                        raise invalid('`button` must be left, right or middle.')
                    if kind == 'click':
                        count = optional_int(event, 'count') or 1
                        if count not in (1, 2, 3):
                            raise invalid('`count` must be 1, 2 or 3.')
                        self.screen.click(button, count)
                    else:
                        self.screen.button(button, kind == 'down')
                elif kind == 'scroll':
                    dx, dy = optional_int(event, 'dx') or 0, optional_int(event, 'dy') or 0
                    if abs(dx) > 200 or abs(dy) > 200:
                        raise invalid('`dx` and `dy` are wheel notches, at most 200.')
                    self.screen.wheel(dx, dy)
            elif kind == 'text':
                self.keyboard.type(require_string(event, 'text'), INPUT_TYPE_DELAY_MS)
            elif kind == 'key':
                self.keyboard.press(require_string(event, 'keys'))
            else:
                raise invalid(f'`{kind}` is not an input event.')
        return {}

    def answer(self, method, params):
        if method == 'configure':
            return self.configure(params)
        if method == 'permissions':
            return {'accessibility': True, 'screenRecording': True}
        if method == 'apps':
            return self.apps(params)
        if method == 'snapshot':
            return self.snapshot(params)
        if method == 'act':
            return self.act(params)
        if method == 'release':
            # The agent's pointer is the screen's own; it stays where the last action left it.
            return {}
        if method == 'input':
            return self.input(params)
        raise invalid(f'`{method}` is not a method.')


# MARK: Main

output_lock = threading.Lock()


def send(answer):
    line = json.dumps(answer, ensure_ascii=False, separators=(',', ':')) + '\n'
    with output_lock:
        try:
            sys.stdout.write(line)
            sys.stdout.flush()
        except (BrokenPipeError, ValueError):
            os._exit(0)


def read_loop(requests):
    for line in sys.stdin:
        requests.put(line)
    # Input closed: the daemon is done with the helper. What is running is told to stop where it is,
    # so text being typed does not run on; what was still waiting is not started.
    closing.set()
    requests.put(None)
    timer = threading.Timer(CLOSING_GRACE_S, lambda: os._exit(0))
    timer.daemon = True
    timer.start()


def main():
    try:
        helper = Helper()
    except Exception as error:  # noqa: BLE001
        log(f'cannot reach the display: {error}')
        sys.exit(1)
    requests = queue.Queue()
    threading.Thread(target=read_loop, args=(requests,), daemon=True).start()
    while True:
        line = requests.get()
        if line is None or closing.is_set():
            os._exit(0)
        if not line.strip():
            continue
        try:
            request = json.loads(line)
            if not isinstance(request, dict):
                raise ValueError
        except ValueError:
            send({'id': 0, 'ok': False, 'code': 'invalid_request', 'message': 'The request is not a JSON object.'})
            continue
        request_id = request.get('id', 0)
        method = request.get('method')
        params = request.get('params') if isinstance(request.get('params'), dict) else {}
        if not isinstance(method, str):
            send({'id': request_id, 'ok': False, 'code': 'invalid_request', 'message': 'The request has no `method`.'})
            continue
        try:
            send({'id': request_id, 'ok': True, 'result': helper.answer(method, params)})
        except ControlError as error:
            send({'id': request_id, 'ok': False, 'code': error.code, 'message': error.message})
        except xerror.XError as error:
            send({'id': request_id, 'ok': False, 'code': 'not_found', 'message': f'The window is gone ({error.__class__.__name__}).'})
        except xerror.ConnectionClosedError as error:
            # The display went away: answer, then leave so the next request starts a helper on the new one.
            send({'id': request_id, 'ok': False, 'code': 'failed', 'message': f'The screen stopped: {error}'})
            os._exit(1)
        except Exception as error:  # noqa: BLE001
            log(f'{method} failed: {error!r}')
            send({'id': request_id, 'ok': False, 'code': 'failed', 'message': f'{method} failed: {error}'})


if __name__ == '__main__':
    main()
