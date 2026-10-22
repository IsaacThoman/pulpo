"""Real packet regression in disposable Linux namespaces; run this file as root.

No production bridge, CNI configuration, or firewall table is touched. Ordinary
unprivileged unittest discovery skips this test; workspace-network CI runs it.
"""
import json
import os
import secrets
import subprocess
import sys
import unittest

import guard
import verify_l2


@unittest.skipUnless(os.geteuid() == 0, 'requires root and network namespaces')
class GuardKernelTest(unittest.TestCase):
    def setUp(self):
        self.names = []
        self.processes = []
        self.suffix = secrets.token_hex(3)
        self.addCleanup(self.cleanup)
        self.host = self.namespace('host')
        self.command(self.host, 'ip', 'link', 'add', 'cni0', 'type', 'bridge')
        self.command(self.host, 'ip', 'link', 'set', 'cni0', 'address', '02:00:00:00:00:01')
        self.command(self.host, 'ip', 'addr', 'add', '10.42.0.1/24', 'dev', 'cni0')
        self.command(self.host, 'ip', '-6', 'addr', 'add', 'fe80::1/64', 'dev', 'cni0', 'nodad')
        self.command(self.host, 'ip', 'link', 'set', 'cni0', 'up')
        self.command(self.host, 'sysctl', '-qw', 'net.ipv4.ip_forward=1')
        # The independent bridge rules must work without br_netfilter support.
        self.command(self.host, 'sh', '-c', 'if test -f /proc/sys/net/bridge/bridge-nf-call-iptables; then sysctl -qw net.bridge.bridge-nf-call-iptables=0; fi')
        self.entries = {}
        self.guests = {}
        for number, role in [(2, 'workspace'), (3, 'workspace'), (4, 'proxy'), (5, 'controller')]:
            self.guests[number] = self.attach(number, role)
        self.config = {'bridge': 'cni0', 'namespace': 'pulpo-workspaces', 'network': 'cbr0',
                       'gateway': '10.42.0.1', 'hostIPv6': 'fe80::1', 'proxyService': '10.43.47.50'}
        self.rules = guard.render(self.entries, self.config)
        # Repeated loading must replace only the guard's own tables atomically.
        for _ in range(2):
            self.command(self.host, guard.NFT, '-f', '-', input=self.rules)
        self.command(self.host, guard.NFT, '-f', '-', input='''
table ip qa_nat {
 chain prerouting {
  type nat hook prerouting priority dstnat; policy accept;
  ip daddr 10.43.47.50 tcp dport 4750 dnat to 10.42.0.4:4750
 }
 chain postrouting {
  type nat hook postrouting priority srcnat; policy accept;
  # Force service replies back through the test gateway for reverse NAT.
  # With br_netfilter deliberately disabled, direct bridge replies do not
  # traverse the IP NAT hooks (even without the guard installed).
  ct status dnat masquerade
 }
}
''')

    def namespace(self, role):
        name = 'pg-' + self.suffix + '-' + role
        subprocess.run(['ip', 'netns', 'add', name], check=True)
        self.names.append(name)
        self.command(name, 'ip', 'link', 'set', 'lo', 'up')
        return name

    def command(self, namespace, *args, **kwargs):
        return subprocess.check_output(['ip', 'netns', 'exec', namespace, *args], text=True, **kwargs)

    def attach(self, number, role=None):
        namespace = self.namespace(str(number))
        host, peer = 'p' + str(number), 'q' + str(number)
        self.command(self.host, 'ip', 'link', 'add', host, 'type', 'veth', 'peer', 'name', peer)
        self.command(self.host, 'ip', 'link', 'set', peer, 'netns', namespace)
        self.command(namespace, 'ip', 'link', 'set', peer, 'name', 'eth0')
        mac = '02:00:00:00:00:' + format(number, '02x')
        self.command(namespace, 'ip', 'link', 'set', 'eth0', 'address', mac)
        self.command(namespace, 'ip', 'addr', 'add', '10.42.0.' + str(number) + '/24', 'dev', 'eth0')
        self.command(namespace, 'ip', 'link', 'set', 'eth0', 'up')
        self.command(namespace, 'ip', 'route', 'add', 'default', 'via', '10.42.0.1')
        self.command(self.host, 'ip', 'link', 'set', host, 'master', 'cni0')
        self.command(self.host, 'ip', 'link', 'set', host, 'up')
        if role:
            link = json.loads(self.command(self.host, 'ip', '-j', 'link', 'show', host))[0]
            self.entries[str(number)] = {'host': host, 'ifindex': link['ifindex'], 'mac': mac,
                                         'ip': '10.42.0.' + str(number), 'ipv6': guard.link_local(mac), 'role': role}
        return namespace

    def process(self, namespace, code):
        process = subprocess.Popen(['ip', 'netns', 'exec', namespace, sys.executable, '-u', '-c', code],
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.processes.append(process)
        self.assertEqual(process.stdout.readline().strip(), 'READY')
        return process

    def server(self, namespace, port):
        self.process(namespace, '''import socket,time
s=socket.socket();s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);s.bind(('0.0.0.0',PORT));s.listen();s.settimeout(.2)
print('READY',flush=True)
end=time.monotonic()+30
while time.monotonic()<end:
 try:c,_=s.accept();c.sendall(b'qa-ok');c.close()
 except socket.timeout:pass
'''.replace('PORT', str(port)))

    def connect(self, namespace, host, port):
        output = self.command(namespace, sys.executable, '-c', '''import socket
try:
 s=socket.create_connection((HOST,PORT),timeout=.4);s.settimeout(.4);print(s.recv(16).decode());s.close()
except OSError:print('blocked')
'''.replace('HOST', repr(host)).replace('PORT', str(port)))
        return output.strip()

    def test_real_packets_cannot_spoof_or_bypass_bridge_policy(self):
        self.server(self.guests[2], 8787)
        self.server(self.guests[3], 8787)
        self.server(self.guests[4], 4750)
        self.server(self.host, 41876)
        self.assertEqual(self.connect(self.host, '10.42.0.2', 8787), 'qa-ok')
        self.assertEqual(self.connect(self.guests[5], '10.42.0.2', 8787), 'qa-ok')
        self.assertEqual(self.connect(self.guests[2], '10.42.0.4', 4750), 'qa-ok')
        self.assertEqual(self.connect(self.guests[2], '10.43.47.50', 4750), 'qa-ok')
        self.assertEqual(self.connect(self.guests[2], '10.42.0.3', 8787), 'blocked')
        self.assertEqual(self.connect(self.guests[3], '10.42.0.2', 8787), 'blocked')
        self.assertEqual(self.connect(self.guests[2], '10.42.0.1', 41876), 'blocked')
        # The new port has no guard registration. Even cloning a registered
        # workspace's entire source identity must not give it connectivity.
        unknown = self.attach(6)
        self.assertEqual(self.connect(unknown, '10.42.0.4', 4750), 'blocked')
        for source, destination in [(2, 3), (3, 2)]:
            with self.subTest(source=source, destination=destination):
                receiver = self.process(self.guests[destination], verify_l2.RECEIVER)
                target = '10.42.0.' + str(destination)
                self.command(self.host, sys.executable, '-c',
                             "import socket;s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);s.sendto(b'pulpo-l2-qa:host-control',(" + repr(target) + ",41875))")
                config = {'srcmac': self.entries[str(source)]['mac'], 'dstmac': self.entries[str(destination)]['mac'],
                          'srcip': '10.42.0.' + str(source), 'dstip': target,
                          'gateway': '10.42.0.1', 'controller': '10.42.0.5'}
                sender = verify_l2.SENDER.replace('CONFIG', repr(config))
                self.command(self.guests[source], sys.executable, '-c', sender)
                self.command(unknown, sys.executable, '-c', sender)
                output, error = receiver.communicate(timeout=10)
                self.assertEqual(receiver.returncode, 0, error)
                result = json.loads(output)
                self.assertEqual(set(result['frames']), {'host-control'})
                self.assertEqual([m['label'] for m in result['messages']], ['host-control'])
        counters = json.loads(self.command(self.host, guard.NFT, '-j', 'list', 'table', 'bridge', guard.TABLE))
        unknown_drops = [e['counter']['packets'] for item in counters['nftables'] if 'rule' in item
                         and item['rule'].get('comment') == 'Unregistered port or forged Ethernet source'
                         for e in item['rule']['expr'] if 'counter' in e]
        self.assertGreaterEqual(sum(unknown_drops), 8)

    def cleanup(self):
        for process in self.processes:
            if process.poll() is None:
                process.terminate()
            process.communicate(timeout=5)
        for name in reversed(self.names):
            subprocess.run(['ip', 'netns', 'del', name], capture_output=True, check=False)


if __name__ == '__main__':
    unittest.main()
