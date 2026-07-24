const fs = require("node:fs");
const path = require("node:path");

function fail(message) {
  throw new Error(`打包后的 Hub 校验失败：${message}`);
}

function packageJsonPath(root, packageName) {
  return path.join(root, "node_modules", ...packageName.split("/"), "package.json");
}

function main() {
  const appRootArg = process.argv[2];
  if (!appRootArg) fail("缺少 win-unpacked 目录参数");

  const appRoot = path.resolve(process.cwd(), appRootArg);
  const backendRoot = path.join(appRoot, "resources", "backend");
  const backendPackagePath = path.join(backendRoot, "package.json");
  const appEntry = path.join(backendRoot, "src", "app.js");

  if (!fs.existsSync(backendPackagePath)) fail(`找不到 ${backendPackagePath}`);
  if (!fs.existsSync(appEntry)) fail(`找不到 ${appEntry}`);

  const backendPackage = JSON.parse(fs.readFileSync(backendPackagePath, "utf8"));
  const dependencies = Object.keys(backendPackage.dependencies || {});

  for (const dependency of dependencies) {
    const manifest = packageJsonPath(backendRoot, dependency);
    if (!fs.existsSync(manifest)) fail(`缺少运行时依赖 ${dependency}`);

    const resolved = require.resolve(dependency, { paths: [backendRoot] });
    const dependencyRoot = path.dirname(manifest);
    const relative = path.relative(dependencyRoot, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      fail(`运行时依赖 ${dependency} 错误地解析到了安装包外：${resolved}`);
    }
  }

  const packagedApp = require(appEntry);
  if (typeof packagedApp.createApp !== "function") fail("src/app.js 没有导出 createApp");

  console.log(`打包后的 Hub 校验通过：${dependencies.length} 个运行时依赖均已包含`);
}

main();
