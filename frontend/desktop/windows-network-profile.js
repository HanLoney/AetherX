const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

async function inspectWindowsNetworkProfiles(options = {}) {
  if ((options.platform || process.platform) !== "win32") return unavailable("unsupported");
  try {
    const result = await (options.execFileImpl || execFileAsync)(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-NetConnectionProfile | Where-Object { $_.IPv4Connectivity -ne 'Disconnected' -or $_.IPv6Connectivity -ne 'Disconnected' } | Select-Object Name,InterfaceAlias,NetworkCategory,IPv4Connectivity,IPv6Connectivity | ConvertTo-Json -Compress"
      ],
      { windowsHide: true, timeout: 4000, maxBuffer: 256 * 1024 }
    );
    return summarizeProfiles(parseProfiles(result.stdout));
  } catch (error) {
    return { ...unavailable("unavailable"), error: String(error?.message || error) };
  }
}

function parseProfiles(value) {
  const text = String(value || "").trim();
  if (!text) return [];
  const parsed = JSON.parse(text);
  return (Array.isArray(parsed) ? parsed : [parsed]).map((profile) => ({
    name: String(profile?.Name || ""),
    interfaceAlias: String(profile?.InterfaceAlias || ""),
    category: normalizeNetworkCategory(profile?.NetworkCategory),
    ipv4Connectivity: String(profile?.IPv4Connectivity || ""),
    ipv6Connectivity: String(profile?.IPv6Connectivity || "")
  }));
}

function normalizeNetworkCategory(value) {
  const category = String(value ?? "").trim().toLowerCase();
  if (category === "0" || category === "public") return "public";
  if (category === "1" || category === "private") return "private";
  if (category === "2" || category === "domainauthenticated") return "domainauthenticated";
  return "unknown";
}

function summarizeProfiles(profiles) {
  const physical = profiles.filter((profile) => !isPrivateTunnel(profile.interfaceAlias));
  const relevant = physical.length ? physical : profiles;
  const hasPrivate = relevant.some((profile) => profile.category === "private");
  const hasPublic = relevant.some((profile) => profile.category === "public");
  return {
    status: hasPrivate ? "private" : hasPublic ? "public" : relevant.length ? "unknown" : "offline",
    private: hasPrivate,
    public: hasPublic,
    profiles: relevant
  };
}

function isPrivateTunnel(value) {
  return /tailscale|wireguard|zerotier|vpn/i.test(String(value || ""));
}

function unavailable(status) {
  return { status, private: false, public: false, profiles: [], error: "" };
}

module.exports = {
  inspectWindowsNetworkProfiles,
  normalizeNetworkCategory,
  parseProfiles,
  summarizeProfiles
};
