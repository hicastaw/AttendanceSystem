"""Small systemd notify adapter; no shell, no dependency and no health fabrication."""
import os
import socket


def notify(value):
    address=os.environ.get('NOTIFY_SOCKET')
    if not address:
        return False
    if address.startswith('@'):
        address='\0'+address[1:]
    family=getattr(socket,'AF_UNIX',None)
    if family is None:raise RuntimeError('Systemd notify requires Unix datagram support')
    with socket.socket(family,socket.SOCK_DGRAM) as connection:
        connection.connect(address)
        connection.sendall(value.encode('ascii'))
    return True
