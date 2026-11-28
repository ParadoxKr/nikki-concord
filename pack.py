#!/usr/bin/env python3
"""Build an unsigned APK (OpenWrt 25.12+) or IPK (OpenWrt/ImmortalWrt 23.05/24.10) package."""
import gzip
import hashlib
import io
import os
import sys
import tarfile
from pathlib import Path

root = Path(sys.argv[1]).resolve()
destination = Path(sys.argv[2])
mtime = int(os.environ.get("SOURCE_DATE_EPOCH", "0"))
package = "luci-app-nikki-concord"
prefix = package + "-"
if not destination.name.startswith(prefix) or destination.suffix not in (".apk", ".ipk"):
    raise SystemExit(f"Expected {prefix}<version>[_<arch>].apk or .ipk")
version, _, arch = destination.stem.removeprefix(prefix).partition("_")
arch = arch or "aarch64_cortex-a53"
machines = {
    "aarch64_cortex-a53": 183,
    "aarch64_cortex-a72": 183,
    "aarch64_generic": 183,
    "x86_64": 62,
}
if not version or arch not in machines:
    raise SystemExit(f"Unsupported package version or architecture in {destination.name}")

core = root / "usr/libexec/nikkic/concord"
core_stream = core.open("rb") if core.exists() else gzip.open(core.with_suffix(".gz"), "rb")
with core_stream as executable, (root / "usr/libexec/nikkic-log").open("rb") as logger:
    for name, stream in (("Concord", executable), ("nikkic-log", logger)):
        header = stream.read(20)
        if not header.startswith(b"\x7fELF\x02\x01") or int.from_bytes(header[18:20], "little") != machines[arch]:
            raise SystemExit(f"{name} binary does not match package architecture {arch}")

depends = [
    "luci-base",
    "rpcd-mod-ucode",
    "ca-bundle",
    "curl",
    "yq",
    "busybox",
    "ip-full",
    "jsonfilter",
    "firewall4",
    "nftables-json",
    "kmod-inet-diag",
    "kmod-nft-socket",
    "kmod-nft-tproxy",
    "kmod-tun",
    "kmod-dummy",
]
installed_size = sum(p.stat().st_size for p in root.rglob("*") if not p.is_symlink() and p.is_file())
pkgdesc = "Nikki Concord - LuCI service with the Concord core"
project = Path(__file__).resolve().parent
hook = (project / "files/post-install.sh").read_bytes()
firewall = (project / "files/firewall-register.sh").read_bytes()


def metadata(info):
    info.uid = info.gid = 0
    info.uname = info.gname = "root"
    info.mtime = mtime
    return info


if destination.suffix == ".apk":
    def package_entry(info):
        info = metadata(info)
        if info.isfile():
            value = (root / info.name).read_bytes()
        elif info.issym():
            value = info.linkname.encode()
        else:
            return info
        info.pax_headers["APK-TOOLS.checksum.SHA1"] = hashlib.sha1(value).hexdigest()
        return info

    payload = io.BytesIO()
    with gzip.GzipFile(fileobj=payload, mode="wb", mtime=mtime) as compressed:
        with tarfile.open(fileobj=compressed, mode="w|", format=tarfile.PAX_FORMAT) as tar:
            for item in sorted(root.iterdir()):
                tar.add(item, arcname=item.name, filter=package_entry)
    data = payload.getvalue()
    info = "\n".join([
        f"pkgname = {package}",
        f"pkgver = {version}",
        f"pkgdesc = {pkgdesc}",
        f"provides = luci-app-nikkic={version}",
        "replaces = luci-app-nikkic",
        "url = https://github.com/user-7392/nikki-concord",
        f"arch = {arch}",
        "license = GPL-3.0-or-later",
        f"size = {installed_size}",
        *[f"depend = {dep}" for dep in depends],
        f"datahash = {hashlib.sha256(data).hexdigest()}",
        "",
    ]).encode()

    def control_entry(name, content, mode):
        entry = metadata(tarfile.TarInfo(name))
        entry.size = len(content)
        entry.mode = mode
        return entry.tobuf(format=tarfile.USTAR_FORMAT) + content + b"\0" * (-len(content) % 512)

    upgrade_hook = hook.replace(b"#!/bin/sh\n", b"#!/bin/sh\nNIKKIC_PACKAGE_UPGRADE=1\n", 1)
    disable_boot_hook = b"""#!/bin/sh
[ -z "${IPKG_INSTROOT:-}" ] && [ "${IPKG_NO_SCRIPT:-0}" != 1 ] || exit 0
/etc/init.d/nikkic disable
"""
    unregister = firewall.replace(b"#!/bin/sh\n", b"""#!/bin/sh
NIKKIC_REMOVE_FIREWALL=1
if [ -z "${IPKG_INSTROOT:-}" ] && [ "${IPKG_NO_SCRIPT:-0}" != 1 ] &&
    [ -x /etc/init.d/ucitrack ]; then
    trap '/etc/init.d/ucitrack reload >/dev/null 2>&1 || :' EXIT
fi
""", 1)
    control_payload = b"".join([
        control_entry(".PKGINFO", info, 0o644),
        control_entry(".post-install", hook, 0o755),
        control_entry(".post-upgrade", upgrade_hook, 0o755),
        control_entry(".pre-deinstall", disable_boot_hook, 0o755),
        control_entry(".post-deinstall", unregister, 0o755),
    ])
    destination.write_bytes(gzip.compress(control_payload, mtime=mtime) + data)
else:
    def add_bytes(tar, name, content, mode):
        entry = metadata(tarfile.TarInfo(name))
        entry.size = len(content)
        entry.mode = mode
        tar.addfile(entry, io.BytesIO(content))

    data_buf = io.BytesIO()
    with gzip.GzipFile(fileobj=data_buf, mode="wb", mtime=mtime) as gz:
        with tarfile.open(fileobj=gz, mode="w|", format=tarfile.GNU_FORMAT) as tar:
            for item in sorted(root.iterdir()):
                tar.add(item, arcname="./" + item.name, filter=metadata)
    data_tgz = data_buf.getvalue()

    control = "\n".join([
        f"Package: {package}",
        f"Version: {version}",
        f"Depends: {', '.join(depends)}",
        "Provides: luci-app-nikkic",
        "Replaces: luci-app-nikkic",
        "Section: luci",
        f"Architecture: {arch}",
        f"Installed-Size: {installed_size}",
        f"Description: {pkgdesc}",
        "",
    ]).encode()

    conffiles = "\n".join(
        "/" + rel
        for rel in (
            "etc/config/nikkic",
            "etc/nikkic/mixin.yaml",
            "etc/nikkic/profiles/default.yaml",
            "etc/nikkic/nftables/geoip_cn.nft",
            "etc/nikkic/nftables/geoip6_cn.nft",
        )
        if (root / rel).is_file()
    ).encode() + b"\n"

    preinst = b"""#!/bin/sh
[ -z "${IPKG_INSTROOT:-}" ] && [ "${IPKG_NO_SCRIPT:-0}" != 1 ] || exit 0
if [ "${1:-}" = "upgrade" ] || [ -x /etc/nikkic/scripts/health.sh ]; then
    : > /tmp/.nikkic-opkg-upgrade
fi
"""
    postinst = hook.replace(
        b"#!/bin/sh\n",
        b"""#!/bin/sh
if [ -f /tmp/.nikkic-opkg-upgrade ]; then
    rm -f /tmp/.nikkic-opkg-upgrade
    NIKKIC_PACKAGE_UPGRADE=1
fi
""",
        1,
    )
    prerm = b"""#!/bin/sh
[ -z "${IPKG_INSTROOT:-}" ] && [ "${IPKG_NO_SCRIPT:-0}" != 1 ] || exit 0
[ "${1:-}" = "remove" ] || exit 0
/etc/init.d/nikkic disable
"""
    postrm = firewall.replace(
        b"#!/bin/sh\n",
        b"""#!/bin/sh
[ -z "${IPKG_INSTROOT:-}" ] && [ "${IPKG_NO_SCRIPT:-0}" != 1 ] || exit 0
[ "${1:-}" = "remove" ] || exit 0
NIKKIC_REMOVE_FIREWALL=1
if [ -x /etc/init.d/ucitrack ]; then
    trap '/etc/init.d/ucitrack reload >/dev/null 2>&1 || :' EXIT
fi
""",
        1,
    )

    control_buf = io.BytesIO()
    with gzip.GzipFile(fileobj=control_buf, mode="wb", mtime=mtime) as gz:
        with tarfile.open(fileobj=gz, mode="w|", format=tarfile.GNU_FORMAT) as tar:
            add_bytes(tar, "./control", control, 0o644)
            add_bytes(tar, "./conffiles", conffiles, 0o644)
            add_bytes(tar, "./preinst", preinst, 0o755)
            add_bytes(tar, "./postinst", postinst, 0o755)
            add_bytes(tar, "./prerm", prerm, 0o755)
            add_bytes(tar, "./postrm", postrm, 0o755)
    control_tgz = control_buf.getvalue()

    outer_buf = io.BytesIO()
    with gzip.GzipFile(fileobj=outer_buf, mode="wb", mtime=mtime) as gz:
        with tarfile.open(fileobj=gz, mode="w|", format=tarfile.GNU_FORMAT) as tar:
            add_bytes(tar, "./debian-binary", b"2.0\n", 0o644)
            add_bytes(tar, "./control.tar.gz", control_tgz, 0o644)
            add_bytes(tar, "./data.tar.gz", data_tgz, 0o644)
    destination.write_bytes(outer_buf.getvalue())
