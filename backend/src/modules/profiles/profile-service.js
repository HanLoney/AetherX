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
      bio: text(input.bio, 2000),
      occupation: text(input.occupation, 200),
      goals: goals.map((goal) => text(goal, 500)).filter(Boolean).slice(0, 30)
    });
  }
}

function text(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

module.exports = { ProfileService };
