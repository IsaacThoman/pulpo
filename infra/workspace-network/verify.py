#!/usr/bin/env python3
"""Verify two existing workspace pods; run on their K3s node as root.

Uses temporary UDP echo listeners (45-second lifetime) and no installed files
inside pods. Requires adjacent probe.py. Does not create/delete pods or policies.
"""
import argparse
import concurrent.futures
import ipaddress
import json
from pathlib import Path
import socket
import subprocess
import sys

KUBE = ['k3s', 'kubectl', '-n', 'pulpo-workspaces']
UDP_PORT = 41873
LISTENER = '''import socket,time,selectors
poll=selectors.DefaultSelector()
for family,kind,host,port in [(socket.AF_INET,socket.SOCK_DGRAM,'0.0.0.0',41873),(socket.AF_INET6,socket.SOCK_DGRAM,'::',41873),(socket.AF_INET6,socket.SOCK_STREAM,'::',41874)]:
 s=socket.socket(family,kind)
 s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
 if family==socket.AF_INET6: s.setsockopt(socket.IPPROTO_IPV6,socket.IPV6_V6ONLY,1)
 s.bind((host,port))
 if kind==socket.SOCK_STREAM: s.listen()
 poll.register(s,selectors.EVENT_READ,kind)
end=time.monotonic()+45
while time.monotonic()<end:
 for event,_ in poll.select(timeout=1):
  s=event.fileobj
  if event.data==socket.SOCK_STREAM:
   c,_=s.accept();c.close()
  else:
   data,addr=s.recvfrom(512);s.sendto(data,addr)
'''


def kube(*args):
    return subprocess.check_output(KUBE + list(args), text=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pods', nargs=2, required=True)
    parser.add_argument('--node-ip', required=True)
    parser.add_argument('--lan-ip', required=True)
    parser.add_argument('--dns-ip', default='10.43.0.10')
    parser.add_argument('--controller-nodeport', type=int, default=30443)
    parser.add_argument('--expect-ping', choices=['allowed', 'blocked'], default='blocked')
    parser.add_argument('--expect-ipv6', choices=['allowed', 'blocked'], default='blocked')
    args = parser.parse_args()
    if args.pods[0] == args.pods[1]:
        parser.error('two distinct pods are required')
    pods = [json.loads(kube('get', 'pod', name, '-o', 'json')) for name in args.pods]
    for pod in pods:
        if pod['metadata']['labels'].get('app.kubernetes.io/name') != 'pulpo-workspace':
            parser.error('both pods must be selected by the workspace NetworkPolicy')
        if pod['status'].get('phase') != 'Running' or not pod['status'].get('podIP'):
            parser.error('both pods must be running')
        if pod['spec'].get('hostNetwork') or pod['spec'].get('runtimeClassName') != 'kata-pulpo-bounded':
            parser.error('expected bounded Kata pods without hostNetwork')
    controllers = json.loads(kube('get', 'pod', '-l', 'app.kubernetes.io/name=pulpo-workspace-controller', '-o', 'json'))
    controller = next(p for p in controllers['items'] if p['status']['phase'] == 'Running')
    controller_ip = controller['status']['podIP']
    addresses = []
    for pod in pods:
        text = kube('exec', pod['metadata']['name'], '--', 'cat', '/proc/net/if_inet6')
        addresses.append(next((str(ipaddress.IPv6Address(int(line.split()[0], 16)))
                               for line in text.splitlines() if line.split()[-1] == 'eth0'
                               and line.split()[0].startswith('fe80')), None))
    host_addresses = json.loads(subprocess.check_output(['ip', '-j', '-6', 'addr', 'show', 'cni0'], text=True))
    host_link_local = next((entry['local'] for link in host_addresses for entry in link['addr_info']
                            if entry.get('scope') == 'link'), None)
    probe = Path(__file__).with_name('probe.py').read_text()
    listeners = []
    try:
        for pod in pods:
            listeners.append(subprocess.Popen(KUBE + ['exec', pod['metadata']['name'], '--', 'python3', '-c', LISTENER],
                                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True))
        # Host control confirms that each UDP destination actually responds.
        for pod in pods:
            ip = pod['status']['podIP']
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
                sock.settimeout(1)
                for attempt in range(10):
                    sock.sendto(b'pulpo-network-qa', (ip, UDP_PORT))
                    try:
                        data, _ = sock.recvfrom(512)
                        if data != b'pulpo-network-qa':
                            raise RuntimeError('unexpected host UDP control reply')
                        break
                    except socket.timeout:
                        if attempt == 9:
                            raise RuntimeError('host UDP control failed for ' + ip)
                print('PASS host UDP control', ip, flush=True)
        for address in addresses:
            if not address:
                raise RuntimeError('expected an IPv6 link-local address for IPv6 coverage')
            with socket.create_connection((address + '%cni0', 41874), timeout=2):
                print('PASS host IPv6 TCP control', address, flush=True)
            with socket.socket(socket.AF_INET6, socket.SOCK_DGRAM) as sock:
                sock.settimeout(2)
                target = socket.getaddrinfo(address + '%cni0', UDP_PORT, socket.AF_INET6, socket.SOCK_DGRAM)[0][4]
                sock.sendto(b'pulpo-network-qa', target)
                data, _ = sock.recvfrom(512)
                if data != b'pulpo-network-qa':
                    raise RuntimeError('unexpected IPv6 UDP control reply')
                print('PASS host IPv6 UDP control', address, flush=True)

        def checks(index):
            pod, peer = pods[index], pods[1 - index]
            ping = {'LAN ping': args.lan_ip, 'host ping': args.node_ip,
                    'peer ping': peer['status']['podIP'], 'controller ping': controller_ip}
            if addresses[1 - index]:
                ping['peer IPv6 link-local ping'] = addresses[1 - index] + '%eth0'
            if host_link_local:
                ping['host IPv6 link-local ping'] = host_link_local + '%eth0'
            config = {
                'expect_ping': args.expect_ping == 'allowed', 'ping': ping,
                'blocked_tcp': {
                    'LAN HTTP': [args.lan_ip, 80], 'LAN HTTPS': [args.lan_ip, 443],
                    'host SSH': [args.node_ip, 22], 'host API': [args.node_ip, 6443],
                    'controller pod TCP': [controller_ip, 8786],
                    'controller NodePort TCP': [args.node_ip, args.controller_nodeport],
                    'peer daemon TCP': [peer['status']['podIP'], 8787],
                },
                'peer_ip': peer['status']['podIP'], 'udp_port': UDP_PORT, 'dns_ip': args.dns_ip,
                'peer_ipv6': addresses[1 - index] + '%eth0' if addresses[1 - index] else None,
                'expect_ipv6': args.expect_ipv6 == 'allowed',
            }
            result = subprocess.run(KUBE + ['exec', '-i', pod['metadata']['name'], '--', 'python3', '-', json.dumps(config)],
                                    input=probe, text=True, capture_output=True, timeout=25)
            results = json.loads(result.stdout)
            return {'pod': pod['metadata']['name'], 'ip': pod['status']['podIP'], 'checks': results}

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(checks, range(2)))
        print(json.dumps(results, indent=2), flush=True)
        # Real HTTP health requests from the permitted controller pod to both daemons.
        urls = [f"http://{pod['status']['podIP']}:8787/healthz" for pod in pods]
        js = 'for (const url of ' + json.dumps(urls) + ') { const r = await fetch(url, {signal: AbortSignal.timeout(5000)}); if (!r.ok) throw new Error(url + ": " + r.status); console.log("PASS controller health", url, r.status); }'
        print(kube('exec', controller['metadata']['name'], '--', 'node', '--input-type=module', '-e', js), flush=True)
        if not all(check['pass'] for result in results for check in result['checks']):
            sys.exit(1)
    finally:
        # Listeners have a hard deadline even if SSH/kubectl is interrupted.
        for listener in listeners:
            try:
                listener.communicate(timeout=50)
            except subprocess.TimeoutExpired:
                listener.kill()
                listener.communicate()


if __name__ == '__main__':
    main()
