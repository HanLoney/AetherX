const { HttpError } = require("../../lib/http-error");

const SOURCES = ["explicit", "inferred"];
const SENSITIVITY = ["normal", "personal", "sensitive"];

class PreferenceService {
  constructor(repository) {
    this.repository = repository;
  }

  list(userId, query) {
    return this.repository.list(userId, query.category);
  }

  save(userId, input) {
    const category = requiredText(input.category, "分类", 60);
    const key = requiredText(input.key, "偏好名称", 100);
    const source = SOURCES.includes(input.source) ? input.source : "explicit";
    const sensitivity = SENSITIVITY.includes(input.sensitivity)
      ? input.sensitivity
      : "normal";
    const confidence = clamp(input.confidence ?? (source === "explicit" ? 1 : 0.6));
    return this.repository.save(userId, {
      category,
      key,
      value: input.value,
      source,
      sensitivity,
      confidence
    });
  }

  delete(userId, id) {
    if (!this.repository.delete(userId, id)) {
      throw new HttpError(404, "PREFERENCE_NOT_FOUND", "未找到指定偏好。");
    }
  }
}

function requiredText(value, label, maxLength) {
  const result = String(value ?? "").trim().slice(0, maxLength);
  if (!result) throw new HttpError(400, "INVALID_PREFERENCE", `${label}不能为空。`);
  return result;
}

function clamp(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0.5;
}

module.exports = { PreferenceService };
