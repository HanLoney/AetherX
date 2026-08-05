let savepointSequence = 0;

function runInSavepoint(database, action) {
  const savepoint = `aetherx_${++savepointSequence}`;
  database.exec(`SAVEPOINT ${savepoint}`);
  try {
    const result = action();
    database.exec(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (error) {
    try {
      database.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    } finally {
      database.exec(`RELEASE SAVEPOINT ${savepoint}`);
    }
    throw error;
  }
}

module.exports = { runInSavepoint };
