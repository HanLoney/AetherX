const { HttpError } = require("../../lib/http-error");
const { MODULE_BY_ID, MODULE_MANIFEST, moduleForTool } = require("./module-manifest");

class ModuleManager {
  constructor(repository) {
    this.repository = repository;
  }

  snapshot(userId) {
    const saved = new Map(this.repository.list(userId).map((item) => [item.id, item]));
    const requested = new Map(
      MODULE_MANIFEST.map((module) => [
        module.id,
        module.core
          ? true
          : saved.has(module.id)
            ? saved.get(module.id).enabled
            : module.defaultEnabled
      ])
    );
    const effective = new Map();
    const resolve = (module, trail = new Set()) => {
      if (effective.has(module.id)) return effective.get(module.id);
      if (trail.has(module.id)) return false;
      const nextTrail = new Set(trail).add(module.id);
      const enabled = requested.get(module.id) === true && module.dependencies.every((id) => {
        const dependency = MODULE_BY_ID.get(id);
        return dependency ? resolve(dependency, nextTrail) : false;
      });
      effective.set(module.id, enabled);
      return enabled;
    };
    return MODULE_MANIFEST.map((module) => {
      const blockedBy = module.dependencies.filter((id) => {
        const dependency = MODULE_BY_ID.get(id);
        return !dependency || !resolve(dependency);
      });
      return {
        id: module.id,
        name: module.name,
        description: module.description,
        core: module.core,
        installed: true,
        requestedEnabled: requested.get(module.id) === true,
        enabled: resolve(module),
        dependencies: [...module.dependencies],
        blockedBy,
        updatedAt: saved.get(module.id)?.updatedAt || null
      };
    });
  }

  isEnabled(userId, moduleId) {
    return this.snapshot(userId).find((module) => module.id === moduleId)?.enabled === true;
  }

  assertEnabled(userId, moduleId) {
    if (this.isEnabled(userId, moduleId)) return;
    const module = MODULE_BY_ID.get(moduleId);
    throw new HttpError(
      403,
      "MODULE_DISABLED",
      `${module?.name || moduleId}模块当前已停用。`,
      { moduleId }
    );
  }

  setEnabled(userId, moduleId, enabled) {
    const module = MODULE_BY_ID.get(moduleId);
    if (!module) {
      throw new HttpError(404, "MODULE_NOT_FOUND", "没有找到这个模块。");
    }
    if (module.core) {
      throw new HttpError(409, "CORE_MODULE_REQUIRED", "核心聊天模块不能停用。");
    }
    const next = enabled === true;
    if (next) {
      const disabledDependency = module.dependencies.find(
        (id) => !this.isEnabled(userId, id)
      );
      if (disabledDependency) {
        throw new HttpError(
          409,
          "MODULE_DEPENDENCY_DISABLED",
          `请先启用${MODULE_BY_ID.get(disabledDependency)?.name || disabledDependency}模块。`,
          { moduleId, dependencyId: disabledDependency }
        );
      }
    }
    this.repository.set(userId, moduleId, next);
    if (!next) this.disableDependents(userId, moduleId);
    return this.snapshot(userId);
  }

  disableDependents(userId, moduleId, visited = new Set()) {
    if (visited.has(moduleId)) return;
    visited.add(moduleId);
    for (const module of MODULE_MANIFEST) {
      if (!module.dependencies.includes(moduleId) || module.core) continue;
      this.repository.set(userId, module.id, false);
      this.disableDependents(userId, module.id, visited);
    }
  }

  moduleForTool(toolName) {
    return moduleForTool(toolName);
  }
}

module.exports = { ModuleManager };
