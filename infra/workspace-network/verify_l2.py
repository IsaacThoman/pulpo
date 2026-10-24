#!/usr/bin/env python3
"""Exercise raw-frame isolation between two disposable bounded Kata pods.

Run as root on their K3s node. Only network-check pods are accepted. No packets
are sent to real user workspaces and no existing neighbor entry is poisoned.
Temporary receivers have a hard deadline. Use --expect-spoof allowed only for
a controlled pre-install baseline. Needs CAP_NET_RAW inside the test pods.
"""
import argparse
import json
import socket
import subprocess

KUBE = ['k3s', 'kubectl', '-n', 'pulpo-workspaces']
PORT = 41875
MARKER = 'pulpo-l2-qa:'
RECEIVER = r'''
import json,selectors,socket,time
poll=selectors.DefaultSelector()
raw=socket.socket(socket.AF_PACKET,socket.SOCK_RAW,socket.htons(3));raw.bind(('eth0',0))
udp=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);udp.bind(('0.0.0.0',41875))
poll.register(raw,selectors.EVENT_READ,'raw');poll.register(udp,selectors.EVENT_READ,'udp')
print('READY',flush=True)
end=time.monotonic()+6;frames=[];messages=[]
while time.monotonic()<end:
 for event,_ in poll.select(timeout=0.2):
  data,addr=event.fileobj.recvfrom(4096)
  if b'pulpo-l2-qa:' not in data:continue
  label=data[data.index(b'pulpo-l2-qa:')+12:].decode(errors='replace')
  if event.data=='raw':
   # Ignore our own outgoing ICMP errors containing a copy of the probe.
   if addr[2]!=socket.PACKET_OUTGOING:frames.append(label)
  else:messages.append({'label':label,'source':addr[0]})
print(json.dumps({'frames':frames,'messages':messages}),flush=True)
'''
SENDER = r'''
import socket,struct
c=CONFIG
mac=lambda m:bytes.fromhex(m.replace(':',''))
src=mac(c['srcmac']);dst=mac(c['dstmac']);dip=socket.inet_aton(c['dstip'])
s=socket.socket(socket.AF_PACKET,socket.SOCK_RAW);s.bind(('eth0',0))
def checksum(data):
 if len(data)%2:data+=b'\0'
 x=sum(struct.unpack('!%dH'%(len(data)//2),data));x=(x>>16)+(x&65535);x+=(x>>16);return (~x)&65535
def send_ip(label,source,ethsrc,protocol=17):
 payload=('pulpo-l2-qa:'+label).encode();source=socket.inet_aton(source)
 if protocol==17:body=struct.pack('!HHHH',42831,41875,len(payload)+8,0)+payload
 else:
  body=struct.pack('!HHIIBBHHH',9,8787,42831,0,80,2,1024,0,0)+payload
  pseudo=source+dip+struct.pack('!BBH',0,6,len(body))
  body=body[:16]+struct.pack('!H',checksum(pseudo+body))+body[18:]
 ip=struct.pack('!BBHHHBBH4s4s',69,0,len(body)+20,42831,0,64,protocol,0,source,dip)
 ip=ip[:10]+struct.pack('!H',checksum(ip))+ip[12:]
 s.send(dst+ethsrc+b'\x08\x00'+ip+body)
send_ip('normal-peer',c['srcip'],src)
send_ip('spoof-node',c['gateway'],src)
send_ip('spoof-controller',c['controller'],src,6)
send_ip('spoof-unallocated','10.42.0.254',src)
send_ip('spoof-mac',c['srcip'],mac('02:70:75:6c:70:6f'))
# Claim only an unused address, and only to disposable B; never poison the
# node/controller/proxy or another user's workspace.
arp=struct.pack('!HHBBH',1,0x800,6,4,2)+src+socket.inet_aton('10.42.0.254')+dst+dip
s.send(dst+src+b'\x08\x06'+arp+b'pulpo-l2-qa:arp-forged-ip')
fake=mac('02:70:75:6c:70:6f')
arp=struct.pack('!HHBBH',1,0x800,6,4,2)+fake+socket.inet_aton(c['srcip'])+dst+dip
s.send(dst+src+b'\x08\x06'+arp+b'pulpo-l2-qa:arp-forged-mac')
arp=struct.pack('!HHBBH',1,0x800,6,4,1)+src+socket.inet_aton(c['srcip'])+b'\0'*6+dip
s.send(b'\xff'*6+src+b'\x08\x06'+arp+b'pulpo-l2-qa:arp-peer-discovery')
print('Sent eight controlled test frames')
'''


def kube(*args):
    return subprocess.check_output(KUBE + list(args), text=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pods', nargs=2, required=True)
    parser.add_argument('--gateway', default='10.42.0.1')
    parser.add_argument('--expect-spoof', choices=['allowed', 'blocked'], default='blocked')
    args = parser.parse_args()
    if args.pods[0] == args.pods[1]:
        parser.error('two distinct pods required')
    items = json.loads(kube('get', 'pods', '-o', 'json'))['items']
    targets = []
    for name in args.pods:
        pod = next(p for p in items if p['metadata']['name'] == name)
        if (pod['metadata']['labels'].get('pulpo.dev/state') != 'network-check'
                or pod['metadata']['labels'].get('app.kubernetes.io/name') != 'pulpo-workspace'
                or pod['spec'].get('runtimeClassName') != 'kata-pulpo-bounded'
                or pod['spec'].get('hostNetwork') or pod['status'].get('phase') != 'Running'):
            parser.error('only disposable running bounded Kata network-check pods are accepted')
        targets.append({'name': name, 'ip': pod['status']['podIP'],
                        'mac': kube('exec', name, '--', 'cat', '/sys/class/net/eth0/address').strip()})
    if any(p['status'].get('podIP') == '10.42.0.254' for p in items):
        parser.error('the harmless ARP claim address is occupied')
    controllers = [p for p in items if p['metadata']['labels'].get('app.kubernetes.io/name') == 'pulpo-workspace-controller'
                   and p['status'].get('phase') == 'Running']
    controller = controllers[0]['status']['podIP']
    for a, b in [targets, targets[::-1]]:
        receiver = subprocess.Popen(KUBE + ['exec', b['name'], '--', 'sudo', 'python3', '-u', '-c', RECEIVER],
                                    text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            if receiver.stdout.readline().strip() != 'READY':
                raise RuntimeError('diagnostic receiver did not start')
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as control:
                control.sendto((MARKER + 'host-control').encode(), (b['ip'], PORT))
            config = {'srcmac': a['mac'], 'dstmac': b['mac'], 'srcip': a['ip'], 'dstip': b['ip'],
                      'gateway': args.gateway, 'controller': controller}
            print(kube('exec', a['name'], '--', 'sudo', 'python3', '-c', SENDER.replace('CONFIG', repr(config))).strip())
            output, error = receiver.communicate(timeout=15)
            if receiver.returncode:
                raise RuntimeError(error)
            result = json.loads(output)
            if not any(m['label'] == 'host-control' for m in result['messages']):
                raise RuntimeError('host UDP positive control failed')
            received = set(result['frames']) - {'host-control'}
            if args.expect_spoof == 'blocked':
                if received:
                    raise RuntimeError('forbidden frames reached peer: ' + ', '.join(sorted(received)))
            elif not {'spoof-node', 'arp-forged-ip'}.issubset(received):
                raise RuntimeError('unprotected baseline did not reproduce the bypass')
            if args.expect_spoof == 'allowed' and not any(m['label'] == 'spoof-node' for m in result['messages']):
                raise RuntimeError('forged node packet did not reach UDP application')
            print(json.dumps({'source': a['name'], 'destination': b['name'],
                              'received_test_frames': sorted(received), 'udp_messages': result['messages'], 'pass': True}), flush=True)
        finally:
            # The in-pod receiver also exits on its own after six seconds.
            if receiver.poll() is None:
                receiver.kill()
                receiver.communicate()


if __name__ == '__main__':
    main()
