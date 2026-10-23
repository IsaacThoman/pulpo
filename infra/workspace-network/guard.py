#!/usr/bin/python3
"""Chained CNI guard for the single-node cni0 workspace network.

Bind bridge ingress to CNI-assigned IP/MAC identities before kube-router can
mistake a forged source for the node. Unknown ports fail closed. No guest-side
setting or Kubernetes API lookup participates in enforcement.
"""
import contextlib
import fcntl
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import sys

CONFIG = Path('/etc/pulpo/workspace-network/guard.json')
DISABLED = Path('/etc/pulpo/workspace-network/guard.disabled')
STATE = Path('/var/lib/pulpo-workspace-network/guard')
NET = Path('/sys/class/net')
CACHE = Path('/var/lib/cni/results')
TABLE = 'pulpo_workspace_guard'
NFT = '/usr/sbin/nft'
VERSIONS = ['0.4.0', '1.0.0', '1.1.0']


def run(*args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs)


@contextlib.contextmanager
def locked():
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (STATE / '.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield


def atomic_json(path, data):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, indent=2) + '\n')
    temporary.chmod(0o600)
    temporary.replace(path)


def role(namespace, name, config):
    if not namespace or not name:
        raise ValueError('CNI Kubernetes pod identity is required')
    if namespace != config['namespace']:
        return 'system'
    # These names are assigned by trusted Kubernetes Deployments. Workspaces
    # have no service-account token or permission to create/rename pods.
    if name.startswith('pulpo-workspace-controller-'):
        return 'controller'
    if name.startswith('pulpo-workspace-egress-proxy-'):
        return 'proxy'
    return 'workspace'


def link_local(mac):
    octets = bytearray.fromhex(mac.replace(':', ''))
    octets[0] ^= 2
    return str(ipaddress.IPv6Address(b'\xfe\x80' + b'\0' * 6 + octets[:3] + b'\xff\xfe' + octets[3:]))


def endpoint(result, args, container_id, ifname, config):
    interfaces = result['interfaces']
    guests = [i for i, interface in enumerate(interfaces)
              if interface['name'] == ifname and interface.get('sandbox')]
    if len(guests) != 1:
        raise ValueError('expected one CNI sandbox interface')
    guest_index = guests[0]
    hosts = [interface for interface in interfaces
             if not interface.get('sandbox') and interface['name'] != config['bridge']]
    if len(hosts) != 1:
        raise ValueError('expected one CNI host veth')
    host, guest = hosts[0]['name'], interfaces[guest_index]
    if not re.fullmatch(r'[a-zA-Z0-9_.-]{1,15}', host):
        raise ValueError('invalid host interface name')
    mac = guest['mac'].lower()
    if not re.fullmatch(r'(?:[0-9a-f]{2}:){5}[0-9a-f]{2}', mac):
        raise ValueError('invalid CNI MAC')
    addresses = [ipaddress.ip_interface(entry['address']) for entry in result['ips']
                 if entry.get('interface') == guest_index]
    if len(addresses) != 1 or addresses[0].version != 4:
        raise ValueError('only single-address IPv4 CNI allocations are supported')
    path = NET / host
    if (path / 'master').resolve().name != config['bridge']:
        raise ValueError('CNI host interface is not on the configured bridge')
    return {'id': container_id, 'ifname': ifname, 'host': host,
            'ifindex': int((path / 'ifindex').read_text()), 'mac': mac,
            'ip': str(addresses[0].ip), 'ipv6': link_local(mac),
            'namespace': args.get('K8S_POD_NAMESPACE'), 'pod': args.get('K8S_POD_NAME'),
            'role': role(args.get('K8S_POD_NAMESPACE'), args.get('K8S_POD_NAME'), config)}


def alive(entry, config):
    path = NET / entry['host']
    try:
        return (int((path / 'ifindex').read_text()) == entry['ifindex']
                and (path / 'master').resolve().name == config['bridge'])
    except FileNotFoundError:
        return False


def load(config):
    path = STATE / 'endpoints.json'
    entries = json.loads(path.read_text()) if path.exists() else {}
    return {key: entry for key, entry in entries.items() if alive(entry, config)}


def read_config():
    config = json.loads(CONFIG.read_text())
    # cni0's link-local address may change when the bridge is recreated at boot.
    if (NET / config['bridge']).exists():
        links = json.loads(run('ip', '-j', '-6', 'addr', 'show', config['bridge']))
        address = next((a['local'] for link in links for a in link['addr_info']
                        if a['scope'] == 'link'), None)
        if address:
            config['hostIPv6'] = address
    return config


def adopt(config):
    """Read root-owned libcni cache to protect existing pods without restarting."""
    entries = {}
    for path in CACHE.glob(config['network'] + '-*'):
        cache = json.loads(path.read_text())
        result = cache['result']
        # Old/deleted caches are common. Only a live veth on this bridge counts.
        host = next((i['name'] for i in result.get('interfaces', [])
                     if not i.get('sandbox') and i['name'] != config['bridge']), None)
        guest = next((i for i in result.get('interfaces', []) if i.get('sandbox')), None)
        if not host or not (NET / host).exists() or not guest or not Path(guest['sandbox']).exists():
            continue
        args = dict(cache['cniArgs'])
        entry = endpoint(result, args, cache['containerId'], cache['ifName'], config)
        peer = json.loads(run('nsenter', '--net=' + guest['sandbox'], 'ip', '-j', 'link', 'show', guest['name']))[0]
        if peer.get('link_index') != entry['ifindex'] or peer['address'].lower() != entry['mac']:
            raise ValueError('CNI cache no longer matches the live veth pair: ' + host)
        entries[entry['id'] + ':' + entry['ifname']] = entry
    return entries


def nft_set(name, kind, values):
    values = sorted(set(values))
    elements = ' elements = { ' + ', '.join(values) + ' };' if values else ''
    return f'    set {name} {{ type {kind};{elements} }}\n'


def render(entries, config):
    bridge = config['bridge']
    if not re.fullmatch(r'[a-zA-Z0-9_.-]{1,15}', bridge):
        raise ValueError('invalid bridge')
    gateway = str(ipaddress.IPv4Address(config['gateway']))
    host6 = str(ipaddress.IPv6Address(config['hostIPv6']))
    proxy = str(ipaddress.IPv4Address(config['proxyService']))
    endpoints = sorted(entries.values(), key=lambda item: item['host'])
    workspaces = [entry for entry in endpoints if entry['role'] == 'workspace']
    management = [gateway] + [entry['ip'] for entry in endpoints if entry['role'] in ['controller', 'proxy']]
    proxies = [proxy] + [entry['ip'] for entry in endpoints if entry['role'] == 'proxy']
    text = f'add table bridge {TABLE}\ndelete table bridge {TABLE}\ntable bridge {TABLE} {{\n'
    text += nft_set('management', 'ipv4_addr', management)
    text += nft_set('proxies', 'ipv4_addr', proxies)
    text += '    chain ingress {\n        type filter hook prerouting priority -310; policy accept;\n'
    text += f'        meta ibrname != "{bridge}" return\n'
    for i, entry in enumerate(endpoints):
        text += f'        meta iif {entry["ifindex"]} iifname "{entry["host"]}" ether saddr {entry["mac"]} goto endpoint_{i}\n'
    text += '        counter drop comment "Unregistered port or forged Ethernet source"\n    }\n'
    for i, entry in enumerate(endpoints):
        text += f'    chain endpoint_{i} {{\n'
        if entry['role'] == 'workspace':
            text += f'        ether type arp arp saddr ether {entry["mac"]} arp saddr ip {entry["ip"]} arp daddr ip @management accept\n'
        else:
            text += f'        ether type arp arp saddr ether {entry["mac"]} arp saddr ip {entry["ip"]} accept\n'
        text += f'        ether type ip ip saddr {entry["ip"]} accept\n'
        if entry['role'] == 'workspace':
            # No IPv6 extension headers or fragments: this IPv4 cluster only
            # retains basic host-admin controls. ND has fixed, checked layouts.
            mac_hex = '0x' + entry['mac'].replace(':', '')
            own_hex = hex(int(ipaddress.IPv6Address(entry['ipv6'])))
            host_hex = hex(int(ipaddress.IPv6Address(host6)))
            prefix = '        ether type ip6 ip6 nexthdr ipv6-icmp ip6 hoplimit 255 icmpv6 code 0'
            text += f'{prefix} ip6 saddr :: ip6 length 24 icmpv6 type nd-neighbor-solicit @nh,384,128 {own_hex} accept\n'
            text += f'{prefix} ip6 saddr {entry["ipv6"]} ip6 length 32 icmpv6 type nd-neighbor-solicit @nh,384,128 {{ {own_hex}, {host_hex} }} @nh,512,16 0x0101 @nh,528,48 {mac_hex} accept\n'
            text += f'{prefix} ip6 saddr {entry["ipv6"]} ip6 length 32 icmpv6 type nd-neighbor-advert @nh,384,128 {own_hex} @nh,512,16 0x0201 @nh,528,48 {mac_hex} accept\n'
            text += f'        ether type ip6 ip6 saddr {entry["ipv6"]} ip6 nexthdr {{ tcp, udp }} accept\n'
            text += f'        ether type ip6 ip6 saddr {entry["ipv6"]} ip6 nexthdr ipv6-icmp icmpv6 type {{ destination-unreachable, packet-too-big, time-exceeded, parameter-problem, echo-reply }} accept\n'
        else:
            text += '        ether type ip6 accept\n'
        text += '        counter drop comment "Invalid endpoint source or protocol"\n    }\n'
    text += '    chain forward {\n        type filter hook forward priority -310; policy accept;\n'
    for entry in workspaces:
        # Evaluate every source port before any destination can accept a frame;
        # interleaving these rules would let later workspaces bypass egress by
        # sending to a workspace listed earlier in the chain.
        text += f'        iifname "{entry["host"]}" ether type ip jump workspace_egress\n'
        text += f'        iifname "{entry["host"]}" ether type ip6 counter drop\n'
    for entry in workspaces:
        # ARP replies/queries for control traffic remain available. Other
        # broadcasts, peer discovery, and bridged IPv6 never enter a workspace.
        text += f'        oifname "{entry["host"]}" ether type arp arp daddr ip {entry["ip"]} arp saddr ip @management accept\n'
        text += f'        oifname "{entry["host"]}" ether type ip ip daddr {entry["ip"]} accept\n'
        text += f'        oifname "{entry["host"]}" counter drop comment "No peer discovery or broadcast delivery"\n'
    text += '    }\n    chain workspace_egress {\n'
    # Native bridge conntrack also enforces direct L2 forwarding when the
    # br_netfilter / iptables bridge sysctl is disabled. Return (not accept) so
    # the destination-port checks above still run for permitted packets.
    text += '        ct direction reply ct state established,related return\n'
    text += '        ip daddr @proxies tcp dport 4750 return\n'
    text += '        counter drop comment "Bridged workspace egress is proxy-only"\n    }\n}\n'
    text += f'add table inet {TABLE}\ndelete table inet {TABLE}\ntable inet {TABLE} {{\n'
    text += nft_set('workspaces', 'ipv4_addr', [entry['ip'] for entry in workspaces])
    text += nft_set('proxies', 'ipv4_addr', proxies)
    text += '    chain egress {\n        type filter hook prerouting priority -190; policy accept;\n'
    text += f'        iifname "{bridge}" ip saddr @workspaces jump workspace_egress\n    }}\n'
    text += '    chain workspace_egress {\n'
    text += '        ct direction reply ct state established,related accept\n'
    text += '        ip daddr @proxies tcp dport 4750 accept\n'
    text += '        counter drop comment "Workspace egress is proxy-only"\n    }\n}\n'
    return text


def apply(entries, config, check=False):
    subprocess.run([NFT, *(['--check'] if check else []), '-f', '-'],
                   input=render(entries, config), text=True, check=True)
    if not check:
        atomic_json(STATE / 'enforcement.json', snapshot())


def snapshot():
    """Compare installed rules during CHECK without changing packet counters."""
    def normalize(value):
        if isinstance(value, list):
            return [normalize(item) for item in value]
        if isinstance(value, dict):
            return {key: (None if key == 'counter' else normalize(item))
                    for key, item in value.items() if key != 'handle'}
        return value
    tables = []
    for family in ['bridge', 'inet']:
        data = json.loads(run(NFT, '-j', 'list', 'table', family, TABLE))
        tables.append(normalize([item for item in data['nftables'] if 'metainfo' not in item]))
    return tables


def main():
    command = os.environ.get('CNI_COMMAND')
    if not command:
        if sys.argv[1:] != ['reload']:
            raise ValueError('use reload, or invoke as a chained CNI plugin')
        with locked():
            if DISABLED.exists():
                raise ValueError('guard is explicitly disabled')
            config = read_config()
            entries = load(config)
            entries.update(adopt(config))
            apply(entries, config)
            atomic_json(STATE / 'endpoints.json', entries)
        return
    request = json.load(sys.stdin)
    if command == 'VERSION':
        print(json.dumps({'cniVersion': '1.1.0', 'supportedVersions': VERSIONS}))
        return
    if request.get('cniVersion') not in VERSIONS:
        raise ValueError('unsupported CNI version')
    if command not in ['ADD', 'DEL', 'CHECK']:
        raise ValueError('unsupported CNI command: ' + command)
    with locked():
        # An explicit, root-owned rollback marker preserves cached CNI DEL
        # support. Recheck inside the lock so rollback/reinstall cannot race it.
        if DISABLED.exists():
            if command == 'ADD':
                print(json.dumps(request['prevResult']))
            return
        config = read_config()
        if request['name'] != config['network']:
            raise ValueError('unexpected CNI network')
        entries = load(config)
        key = os.environ['CNI_CONTAINERID'] + ':' + os.environ['CNI_IFNAME']
        if command == 'DEL':
            entries.pop(key, None)
        else:
            args = dict(part.split('=', 1) for part in os.environ.get('CNI_ARGS', '').split(';') if '=' in part)
            expected = endpoint(request['prevResult'], args, os.environ['CNI_CONTAINERID'], os.environ['CNI_IFNAME'], config)
            if command == 'CHECK':
                if entries.get(key) != expected:
                    raise ValueError('CNI guard identity is missing or changed')
                # A table that exists with missing/changed rules is still broken.
                actual = snapshot()
                if actual != json.loads((STATE / 'enforcement.json').read_text()):
                    raise ValueError('installed guard rules have changed')
                return
            entries[key] = expected
        apply(entries, config)
        atomic_json(STATE / 'endpoints.json', entries)
    if command == 'ADD':
        print(json.dumps(request['prevResult']))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        if os.environ.get('CNI_COMMAND'):
            print(json.dumps({'cniVersion': '1.0.0', 'code': 100, 'msg': str(error)}))
        else:
            print(str(error), file=sys.stderr)
        sys.exit(1)
