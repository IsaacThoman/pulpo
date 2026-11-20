# The workspace's screen (pulpo-desktop): programs started from a login shell open their windows on
# it. Nothing runs until something first uses it; `pulpo-desktop start` brings it up.
export DISPLAY="${DISPLAY:-:1}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/tmp/pulpo-desktop/bus}"
