class ProfileRepository {
  constructor(database) {
    this.database = database;
  }

  get(userId) {
    const row = this.database
      .prepare(
        `SELECT display_name, preferred_name, birthday, bio, occupation, goals_json, updated_at
         FROM user_profiles WHERE user_id = ?`
      )
      .get(userId);
    return row
      ? {
          displayName: row.display_name,
          preferredName: row.preferred_name,
          birthday: row.birthday,
          bio: row.bio,
          occupation: row.occupation,
          goals: JSON.parse(row.goals_json),
          updatedAt: row.updated_at
        }
      : {
          displayName: "",
          preferredName: "",
          birthday: "",
          bio: "",
          occupation: "",
          goals: [],
          updatedAt: null
        };
  }

  save(userId, profile) {
    const updatedAt = Date.now();
    this.database
      .prepare(
        `INSERT INTO user_profiles(
          user_id, display_name, preferred_name, birthday, bio, occupation,
          goals_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          display_name = excluded.display_name,
          preferred_name = excluded.preferred_name,
          birthday = excluded.birthday,
          bio = excluded.bio,
          occupation = excluded.occupation,
          goals_json = excluded.goals_json,
          updated_at = excluded.updated_at`
      )
      .run(
        userId,
        profile.displayName,
        profile.preferredName,
        profile.birthday,
        profile.bio,
        profile.occupation,
        JSON.stringify(profile.goals),
        updatedAt
      );
    return this.get(userId);
  }
}

module.exports = { ProfileRepository };
