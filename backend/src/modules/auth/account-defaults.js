const ASSISTANT_NAME = "小玄";
const ASSISTANT_GENDER = "女";
const ASSISTANT_SELF_DEFINITION = "会持续成长的全能助手";

function defaultRelationship(displayName) {
  return `${displayName}亲密可靠的数字伙伴`;
}

function initializeAccountProfiles(database, userId, displayName, now) {
  database
    .prepare(
      `INSERT OR IGNORE INTO user_profiles(
        user_id, display_name, preferred_name, birthday, bio, occupation,
        goals_json, avatar_data_url, updated_at
      ) VALUES (?, ?, ?, '', '', '', '[]', '', ?)`
    )
    .run(userId, displayName, displayName, now);
  database
    .prepare(
      `INSERT OR IGNORE INTO assistant_profiles(
        user_id, name, gender, self_definition, relationship_summary,
        traits_json, values_json, avatar_data_url, persona_image_data_url,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, '[]', '[]', '', '', ?)`
    )
    .run(
      userId,
      ASSISTANT_NAME,
      ASSISTANT_GENDER,
      ASSISTANT_SELF_DEFINITION,
      defaultRelationship(displayName),
      now
    );
}

function isPristineAccountProfile(database, table, userId) {
  const account = database
    .prepare("SELECT display_name FROM users WHERE id = ?")
    .get(userId);
  if (!account) return false;
  if (table === "user_profiles") {
    const row = database.prepare("SELECT * FROM user_profiles WHERE user_id = ?").get(userId);
    return Boolean(
      row &&
      row.display_name === account.display_name &&
      row.preferred_name === account.display_name &&
      row.birthday === "" &&
      row.bio === "" &&
      row.occupation === "" &&
      row.goals_json === "[]" &&
      row.avatar_data_url === ""
    );
  }
  if (table === "assistant_profiles") {
    const row = database
      .prepare("SELECT * FROM assistant_profiles WHERE user_id = ?")
      .get(userId);
    return Boolean(
      row &&
      row.name === ASSISTANT_NAME &&
      row.gender === ASSISTANT_GENDER &&
      row.self_definition === ASSISTANT_SELF_DEFINITION &&
      row.relationship_summary === defaultRelationship(account.display_name) &&
      row.traits_json === "[]" &&
      row.values_json === "[]" &&
      row.avatar_data_url === "" &&
      row.persona_image_data_url === ""
    );
  }
  return false;
}

module.exports = {
  defaultRelationship,
  initializeAccountProfiles,
  isPristineAccountProfile
};
