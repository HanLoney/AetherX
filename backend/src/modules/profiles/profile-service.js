const { HttpError } = require("../../lib/http-error");

class ProfileService {
  constructor(repository) {
    this.repository = repository;
  }

  get(userId) {
    return this.repository.get(userId);
  }

  save(userId, input) {
    const goals = input.goals ?? [];
    if (!Array.isArray(goals)) {
      throw new HttpError(400, "INVALID_GOALS", "长期目标必须是数组。");
    }
    return this.repository.save(userId, {
      displayName: text(input.displayName, 100),
      preferredName: text(input.preferredName, 100),
      birthday: birthday(input.birthday),
      bio: text(input.bio, 2000),
      occupation: text(input.occupation, 200),
      goals: goals.map((goal) => text(goal, 500)).filter(Boolean).slice(0, 30)
    });
  }

  patch(userId, input) {
    const current = this.repository.get(userId);
    return this.save(userId, {
      ...current,
      ...input,
      goals: input.goals === undefined ? current.goals : input.goals
    });
  }
}

function text(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function birthday(value) {
  const result = String(value ?? "").trim();
  return /^(\d{4}-)?\d{2}-\d{2}$/.test(result) ? result : "";
}

module.exports = { ProfileService };
