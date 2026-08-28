class MemorySettingsService {
  constructor(repository) {
    this.repository = repository;
  }

  get(userId) {
    return this.repository.get(userId);
  }

  save(userId, input) {
    const autoConfirmAll = Boolean(input.autoConfirmAll);
    return this.repository.save(userId, {
      autoConfirm: autoConfirmAll || Boolean(input.autoConfirm),
      autoConfirmAll
    });
  }
}

module.exports = { MemorySettingsService };
