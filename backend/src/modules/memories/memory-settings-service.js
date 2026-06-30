class MemorySettingsService {
  constructor(repository) {
    this.repository = repository;
  }

  get(userId) {
    return this.repository.get(userId);
  }

  save(userId, input) {
    return this.repository.save(userId, {
      autoConfirm: Boolean(input.autoConfirm)
    });
  }
}

module.exports = { MemorySettingsService };
