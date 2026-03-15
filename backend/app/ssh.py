import io
from typing import Tuple, Optional

import paramiko


def _load_private_key(key_str: str) -> paramiko.PKey:
    s = (key_str or "").strip()
    if not s:
        raise ValueError("empty ssh key")
    buf = io.StringIO(s)
    loaders = []
    for cls_name in ("Ed25519Key", "ECDSAKey", "RSAKey", "DSSKey"):
        cls = getattr(paramiko, cls_name, None)
        if cls is None:
            continue
        fn = getattr(cls, "from_private_key", None)
        if fn is None:
            continue
        loaders.append(fn)
    last: Optional[Exception] = None
    for fn in loaders:
        try:
            buf.seek(0)
            return fn(buf)
        except Exception as e:
            last = e
    raise ValueError("unsupported ssh key") from last


def ssh_exec(host: str, username: str, key_str: str, command: str, *, timeout: float = 12.0) -> Tuple[int, str, str]:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = _load_private_key(key_str)
    client.connect(
        hostname=host,
        username=username,
        pkey=pkey,
        timeout=timeout,
        banner_timeout=timeout,
        auth_timeout=timeout,
        look_for_keys=False,
        allow_agent=False,
    )
    try:
        stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
        _ = stdin
        out = stdout.read().decode("utf-8", errors="replace")
        err = stderr.read().decode("utf-8", errors="replace")
        code = stdout.channel.recv_exit_status()
        return code, out, err
    finally:
        try:
            client.close()
        except Exception:
            pass
