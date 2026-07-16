const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const ignoredDirectories = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".gradle"
]);

function walk(directory, predicate, result = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, predicate, result);
    else if (predicate(absolute)) result.push(absolute);
  }
  return result;
}

function checkMarkdownLinks() {
  const failures = [];
  const markdownFiles = walk(root, (file) => file.endsWith(".md"));
  const linkPattern = /!?(?:\[[^\]]*\])\(([^)]+)\)/g;

  for (const file of markdownFiles) {
    const content = fs.readFileSync(file, "utf8");
    for (const match of content.matchAll(linkPattern)) {
      let target = match[1].trim();
      if (target.startsWith("<") && target.endsWith(">")) {
        target = target.slice(1, -1);
      }
      if (
        !target ||
        target.startsWith("#") ||
        /^(?:https?:|mailto:|data:)/i.test(target)
      ) {
        continue;
      }
      target = target.split("#", 1)[0];
      try {
        target = decodeURIComponent(target);
      } catch {
        failures.push(`${path.relative(root, file)}: 无法解码链接 ${target}`);
        continue;
      }
      const resolved = path.resolve(path.dirname(file), target);
      if (!fs.existsSync(resolved)) {
        failures.push(
          `${path.relative(root, file)}: 找不到 ${match[1]} -> ${path.relative(root, resolved)}`
        );
      }
    }
  }

  return { checked: markdownFiles.length, failures };
}

function checkApiCoverage() {
  const routeFiles = walk(
    path.join(root, "backend", "src", "modules"),
    (file) => file.endsWith("-routes.js")
  );
  const routePattern = /router\.add\(\s*"[A-Z]+"\s*,\s*"([^"]+)"/gs;
  const routes = new Set();
  for (const file of routeFiles) {
    const content = fs.readFileSync(file, "utf8");
    for (const match of content.matchAll(routePattern)) {
      routes.add(
        match[1]
          .replace(/^\/api\/v1/, "")
          .replace(/:([A-Za-z][A-Za-z0-9]*)/g, "{$1}")
      );
    }
  }

  const specification = fs.readFileSync(
    path.join(root, "backend", "openapi.yaml"),
    "utf8"
  );
  const documented = new Set(
    [...specification.matchAll(/^  (\/[^:]+):/gm)].map((match) => match[1])
  );
  const failures = [];
  for (const route of routes) {
    if (!documented.has(route)) failures.push(`OpenAPI 缺少路由 ${route}`);
  }
  for (const route of documented) {
    if (!routes.has(route)) failures.push(`OpenAPI 包含不存在的路由 ${route}`);
  }
  return { routes: routes.size, documented: documented.size, failures };
}

function main() {
  const links = checkMarkdownLinks();
  const api = checkApiCoverage();
  const failures = [...links.failures, ...api.failures];
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log(
    `文档检查通过：${links.checked} 个 Markdown 文件，${api.routes} 条 API 路由。`
  );
}

main();
