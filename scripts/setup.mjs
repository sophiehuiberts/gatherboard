import { copyFile, readFile } from 'node:fs/promises';

try {
  await copyFile(new URL('../rooms.example.json', import.meta.url), new URL('../rooms.config.json', import.meta.url), 1);
  console.log('Created rooms.config.json. Set your room passwords before deploying.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
}

try {
  const { rooms } = JSON.parse(await readFile(new URL('../rooms.config.json', import.meta.url), 'utf8'));
  if (!Array.isArray(rooms) || !rooms.length || rooms.length > 50) {
    throw Error('Configure between 1 and 50 rooms.');
  }

  const ids = new Set();
  for (const [index, room] of rooms.entries()) {
    const label = `Room ${index + 1}`;
    if (!room || typeof room !== 'object') throw Error(`${label}: expected a room object.`);
    if (typeof room.id !== 'string' || !/^[a-z0-9-]{1,48}$/.test(room.id)) {
      throw Error(`${label}: id must use 1–48 lowercase letters, numbers, or hyphens.`);
    }
    if (ids.has(room.id)) throw Error(`${label}: id must be unique.`);
    if (typeof room.name !== 'string' || !room.name.trim() || room.name.length > 60) {
      throw Error(`${label}: name must contain 1–60 characters.`);
    }
    if (typeof room.password !== 'string' || !room.password.length) {
      throw Error(`${label}: password must be a non-empty string. Put it in double quotes, even if it contains only numbers.`);
    }
    if (room.password.length > 256) throw Error(`${label}: password must be at most 256 characters.`);
    if (room.description !== undefined && (typeof room.description !== 'string' || room.description.length > 160)) {
      throw Error(`${label}: description must be text, up to 160 characters.`);
    }
    ids.add(room.id);
  }
} catch (error) {
  console.error(`rooms.config.json: ${error.message}`);
  process.exit(1);
}
