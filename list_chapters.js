
const path = require('path');
const { promiseDb: db } = require(path.join(__dirname, 'backend/database'));

async function run() {
  try {
    const rows = await db.all("SELECT id, name FROM chapters");
    console.log("Chapters:", rows);
  } catch (e) {
    console.error(e);
  }
}

run();
