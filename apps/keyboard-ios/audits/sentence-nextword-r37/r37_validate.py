#!/usr/bin/env python3
"""Strict public-schema/static admission. Never loads dictionaries or runs an engine."""
import argparse
import ctypes
import ctypes.util
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODES = ('en_US', 'es', 'en_es')

def strict_load(path):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError(f'duplicate JSON key: {key}')
            result[key] = value
        return result
    def invalid(value):
        raise ValueError(f'non-JSON constant: {value}')
    return json.loads(Path(path).read_text(), object_pairs_hook=pairs, parse_constant=invalid)

def validate(value, rule, root, path='$'):
    def fail(message):
        raise ValueError(f'{path}: {message}')
    if '$ref' in rule:
        return validate(value, root['$defs'][rule['$ref'].removeprefix('#/$defs/')], root, path)
    if 'oneOf' in rule:
        matches = 0
        for choice in rule['oneOf']:
            try:
                validate(value, choice, root, path)
                matches += 1
            except ValueError:
                pass
        if matches != 1:
            fail(f'expected one action schema, matched {matches}')
    def exact(a, b):
        return type(a) is type(b) and a == b
    if 'const' in rule and not exact(value, rule['const']):
        fail('invalid constant')
    if 'enum' in rule and not any(exact(value, x) for x in rule['enum']):
        fail('invalid enum')
    kind = rule.get('type')
    if kind == 'object':
        if type(value) is not dict:
            fail('expected object')
        for key in rule['required']:
            if key not in value:
                fail(f'missing {key}')
        for key, child in value.items():
            if key not in rule['properties']:
                fail(f'unknown field {key}')
            validate(child, rule['properties'][key], root, f'{path}.{key}')
    elif kind == 'array':
        if type(value) is not list:
            fail('expected array')
        if len(value) < rule.get('minItems', 0) or len(value) > rule.get('maxItems', float('inf')):
            fail('array length')
        if rule.get('uniqueItems') and len(set(json.dumps(x, ensure_ascii=False, sort_keys=True) for x in value)) != len(value):
            fail('duplicate items')
        for i, child in enumerate(value):
            validate(child, rule['items'], root, f'{path}[{i}]')
    elif kind == 'string':
        if type(value) is not str or len(value) < rule.get('minLength', 0):
            fail('expected string of required length')
    elif kind == 'integer':
        if type(value) is not int or not rule.get('minimum', 0) <= value <= min(rule.get('maximum', 2**63-1), 2**63-1):
            fail('invalid bounded integer')
    elif kind == 'boolean' and type(value) is not bool:
        fail('expected boolean')

class Characters:
    """ICU grapheme boundaries for static range checks; Swift String is runtime authority."""
    def __init__(self):
        name = ctypes.util.find_library('icucore') or ctypes.util.find_library('icuuc')
        if not name:
            raise RuntimeError('ICU required for static Unicode range checks')
        self.lib = ctypes.CDLL(name)
        def symbol(name):
            for suffix in [''] + [f'_{n}' for n in range(100, 49, -1)]:
                try:
                    return getattr(self.lib, name + suffix)
                except AttributeError:
                    pass
            raise RuntimeError(f'ICU symbol unavailable: {name}')
        self.open = symbol('ubrk_open')
        self.open.restype = ctypes.c_void_p
        self.open.argtypes = [ctypes.c_int32, ctypes.c_char_p, ctypes.POINTER(ctypes.c_uint16), ctypes.c_int32, ctypes.POINTER(ctypes.c_int32)]
        self.next = symbol('ubrk_next'); self.next.restype = ctypes.c_int32; self.next.argtypes = [ctypes.c_void_p]
        self.close = symbol('ubrk_close'); self.close.argtypes = [ctypes.c_void_p]
    def split(self, text):
        raw = text.encode('utf-16-le')
        units = (ctypes.c_uint16 * (len(raw)//2)).from_buffer_copy(raw)
        error = ctypes.c_int32(0)
        iterator = self.open(0, b'root', units, len(units), ctypes.byref(error))
        if not iterator or error.value > 0:
            raise ValueError(f'ICU error {error.value}')
        result, start = [], 0
        try:
            while True:
                end = self.next(iterator)
                if end == -1:
                    return result
                result.append(raw[start*2:end*2].decode('utf-16-le'))
                start = end
        finally:
            self.close(iterator)

def admit(data, schema=None):
    root = schema or strict_load(HERE / 'public-schema.json')
    validate(data, root, root)
    chars = Characters()
    ids = set()
    def bounds(text, caret, selection):
        if caret + selection > len(chars.split(text)):
            raise ValueError('Character range out of bounds')
    for row in data['cases']:
        if row['id'] in ids:
            raise ValueError('duplicate case ID')
        ids.add(row['id'])
        pieces = [row['prefix'], row['selected'], row['suffix']]
        if chars.split(''.join(pieces)) != sum((chars.split(x) for x in pieces), []):
            raise ValueError('input seam splits grapheme')
        if (row['route'] == 'completion') != bool(row['typed']):
            raise ValueError('typed required exactly for completion')
        for gold in row['acceptableByMode'].values():
            if row['oracle'] == 'scored':
                if not 1 <= len(gold) <= 6 or any(any(c.isspace() for c in word) for word in gold):
                    raise ValueError('scored sets require 1–6 exact words')
            elif gold:
                raise ValueError('nonasserting sets must be empty')
        if row['route'] != 'control':
            if row['selected'] or not row['prefix'].endswith(' ') or row['actions'] != [{'action':'observe'}]:
                raise ValueError('primary requires space prefix, empty selection, sole observe')
        elif row['oracle'] != 'control' or any('expect' not in a for a in row['actions']):
            raise ValueError('control requires exact expectations for every action')
        document = ''.join(pieces)
        captures = 0
        for action in row['actions']:
            if action['action'] == 'hostMove':
                bounds(document, action['caret'], action['selectionLength'])
            if action['action'] == 'hostReplace':
                bounds(action['document'], action['caret'], action['selectionLength'])
            if action['action'] == 'replayCapturedSlot' and action['capture'] >= captures:
                raise ValueError('capture out of bounds before execution')
            if action['action'] == 'observe' and row['route'] == 'control':
                if 'slotCount' not in action['expect']:
                    raise ValueError('control observe requires exact slotCount')
                captures += action['expect']['slotCount']
            if 'expect' in action:
                e = action['expect']
                bounds(e['document'], e['caret'], e['selectionLength'])
                document = e['document']
    for pair in data['equivalences']:
        if pair['left'] not in ids or pair['right'] not in ids or pair['left'] == pair['right']:
            raise ValueError('invalid equivalence references')
    if data['cohort'] == 'fresh':
        families = {}
        for row in data['cases']:
            if row['oracle'] == 'control' or row['route'] != 'nextword':
                raise ValueError('fresh requires nextword scored/ambiguous rows')
            families.setdefault(row['familyId'], []).append(row)
        if len(data['cases']) != 72 or len(families) != 36:
            raise ValueError('fresh requires exactly 72 prompts / 36 families / 216 mode rows')
        for label in ('en','es','mixed'):
            if sum(all(r['contentLabel'] == label for r in group) for group in families.values()) != 12:
                raise ValueError('fresh requires 12 families per label')
        for group in families.values():
            if len(group) != 2 or group[0]['prefix'] == group[1]['prefix'] or group[0]['prefix'].split()[-1] != group[1]['prefix'].split()[-1]:
                raise ValueError('family must have two distinct prompts sharing last word')
    return data

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    args = parser.parse_args()
    data = admit(strict_load(args.input))
    print(json.dumps({'staticAdmission':'pass','cohort':data['cohort'],'prompts':len(data['cases']),'modeRows':len(data['cases'])*3,'engineExecution':False}))
