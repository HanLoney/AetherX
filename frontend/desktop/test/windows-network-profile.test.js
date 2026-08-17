const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  inspectWindowsNetworkProfiles,
  parseProfiles,
  summarizeProfiles
} = require("../windows-network-profile");

test("Windows network profiles distinguish public Wi-Fi from private tunnels", () => {
  const profiles = parseProfiles(JSON.stringify([
    {
      Name: "Cafe Wi-Fi",
      InterfaceAlias: "WLAN",
      NetworkCategory: "Public",
      IPv4Connectivity: "Internet",
      IPv6Connectivity: "NoTraffic"
    },
    {
      Name: "Tailnet",
      InterfaceAlias: "Tailscale",
      NetworkCategory: "Private",
      IPv4Connectivity: "LocalNetwork",
      IPv6Connectivity: "LocalNetwork"
    }
  ]));
  assert.deepEqual(summarizeProfiles(profiles), {
    status: "public",
    private: false,
    public: true,
    profiles: [profiles[0]]
  });
});

test("Windows network profile inspection handles one PowerShell object", async () => {
  const result = await inspectWindowsNetworkProfiles({
    platform: "win32",
    execFileImpl: async () => ({
      stdout: JSON.stringify({
        Name: "Home",
        InterfaceAlias: "Wi-Fi",
        NetworkCategory: "Private",
        IPv4Connectivity: "Internet",
        IPv6Connectivity: "NoTraffic"
      })
    })
  });
  assert.equal(result.status, "private");
  assert.equal(result.private, true);
});

test("Windows network profile inspection normalizes numeric PowerShell enums", async () => {
  const result = await inspectWindowsNetworkProfiles({
    platform: "win32",
    execFileImpl: async () => ({
      stdout: JSON.stringify({
        Name: "Public Wi-Fi",
        InterfaceAlias: "WLAN",
        NetworkCategory: 0,
        IPv4Connectivity: 4,
        IPv6Connectivity: 1
      })
    })
  });
  assert.equal(result.status, "public");
  assert.equal(result.public, true);
  assert.equal(result.profiles[0].category, "public");
});

test("NSIS only opens the Hub port on private local subnets", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "installer.nsh"), "utf8");
  const firewallScript = fs.readFileSync(path.join(__dirname, "..", "windows-firewall.ps1"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.match(firewallScript, /-LocalPort 4318/);
  assert.match(firewallScript, /-Profile Private/);
  assert.match(firewallScript, /-RemoteAddress LocalSubnet/);
  assert.match(firewallScript, /-Program \$ProgramPath/);
  assert.doesNotMatch(firewallScript, /-Profile (?:Any|Public)/i);
  assert.match(firewallScript, /Start-Process[\s\S]*-Verb RunAs[\s\S]*exit \$process\.ExitCode/);
  assert.match(firewallScript, /Get-NetFirewallRule[\s\S]*Get-NetFirewallPortFilter[\s\S]*failed validation/);
  assert.match(source, /customInstall[\s\S]*windows-firewall\.ps1[\s\S]*-Action Install/);
  assert.match(source, /customInstall[\s\S]*Pop \$0[\s\S]*\$0 != 0[\s\S]*MessageBox/);
  assert.match(source, /customUnInstall[\s\S]*windows-firewall\.ps1[\s\S]*-Action Uninstall/);
  assert.doesNotMatch(source, /resources\\elevate\.exe/);
  assert.equal(packageJson.build.nsis.packElevateHelper, false);
  assert.deepEqual(packageJson.build.extraResources.find((item) => item.from === "windows-firewall.ps1"), {
    from: "windows-firewall.ps1",
    to: "connection-runtime/windows-firewall.ps1"
  });
});
