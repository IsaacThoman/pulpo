#!/usr/bin/env python3
"""Socket-only checks, executed inside a workspace by verify.py. Installs nothing."""
import concurrent.futures
import json
import os
import socket
import struct
import sys
import urllib.request


def ping(host):
    ipv6 = ':' in host
    family = socket.AF_INET6 if ipv6 else socket.AF_INET
    protocol = socket.IPPROTO_ICMPV6 if ipv6 else socket.IPPROTO_ICMP
    with socket.socket(family, socket.SOCK_DGRAM, protocol) as sock:
        sock.settimeout(2)
        packet = struct.pack('!BBHHH', 128 if ipv6 else 8, 0, 0, os.getpid() & 65535, 1)
        packet += b'pulpo-network-qa'
        if len(packet) % 2:
            packet += b'\0'
        if not ipv6:
            value = sum(struct.unpack('!%dH' % (len(packet) // 2), packet))
            value = (value >> 16) + (value & 65535)
            value += value >> 16
            packet = packet[:2] + struct.pack('!H', (~value) & 65535) + packet[4:]
        target = socket.getaddrinfo(host, 0, family, socket.SOCK_DGRAM)[0][4]
        sock.sendto(packet, target)
        data, _ = sock.recvfrom(4096)
        if data[0] != (129 if ipv6 else 0) or data[8:] != packet[8:]:
            raise RuntimeError('unexpected ICMP response')


def tcp(host, port):
    with socket.create_connection((host, port), timeout=2):
        pass


def udp(host, port):
    family = socket.AF_INET6 if ':' in host else socket.AF_INET
    with socket.socket(family, socket.SOCK_DGRAM) as sock:
        sock.settimeout(2)
        target = socket.getaddrinfo(host, port, family, socket.SOCK_DGRAM)[0][4]
        sock.connect(target)
        sock.send(b'pulpo-network-qa')
        if sock.recv(512) != b'pulpo-network-qa':
            raise RuntimeError('unexpected UDP echo')


def dns(host):
    query_id = os.getpid() & 65535
    query = struct.pack('!6H', query_id, 0x100, 1, 0, 0, 0)
    query += b'\x07example\x03com\0\0\x01\0\x01'
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.settimeout(3)
        sock.connect((host, 53))
        sock.send(query)
        response = sock.recv(4096)
        rid, flags, _, answers, _, _ = struct.unpack('!6H', response[:12])
        if rid != query_id or flags & 15 or not answers:
            raise RuntimeError('DNS response had no successful answer')


def https():
    # Bypass environment proxy settings so this tests the pod's own egress.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open('https://example.com/', timeout=8) as response:
        if response.status != 200 or not response.read(64):
            raise RuntimeError('HTTPS download failed')


def main():
    config = json.loads(sys.argv[1])
    jobs = []
    for label, host in config['ping'].items():
        jobs.append((label, config['expect_ping'], ping, (host,)))
    for label, target in config['blocked_tcp'].items():
        jobs.append((label, False, tcp, tuple(target)))
    jobs.extend([
        ('peer UDP', False, udp, (config['peer_ip'], config['udp_port'])),
        ('cluster DNS UDP', True, dns, (config['dns_ip'],)),
        ('cluster DNS TCP', True, tcp, (config['dns_ip'], 53)),
        ('public HTTPS download', True, https, ()),
    ])
    if config.get('peer_ipv6'):
        jobs.extend([
            ('peer IPv6 TCP', config['expect_ipv6'], tcp, (config['peer_ipv6'], 41874)),
            ('peer IPv6 UDP', config['expect_ipv6'], udp, (config['peer_ipv6'], config['udp_port'])),
        ])

    def check(job):
        label, expected, fn, args = job
        detail = ''
        try:
            fn(*args)
            connected = True
        except OSError as error:
            # Only network refusal/timeout/unreachable counts as blocked.
            # Missing privileges or broken probes must fail, never count as isolation.
            import errno
            if isinstance(error, TimeoutError) or error.errno in {
                errno.ECONNREFUSED, errno.ENETUNREACH, errno.EHOSTUNREACH,
            }:
                connected = False
            else:
                return {'check': label, 'pass': False, 'error': str(error)}
            detail = type(error).__name__ + ': ' + str(error)
        except Exception as error:
            return {'check': label, 'pass': False, 'error': str(error)}
        return {'check': label, 'pass': connected == expected,
                'connected': connected, 'detail': detail}

    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        results = list(pool.map(check, jobs))
    print(json.dumps(results))
    sys.exit(0 if all(result['pass'] for result in results) else 1)


if __name__ == '__main__':
    main()
