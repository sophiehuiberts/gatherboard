import './setup.mjs';
import {readFile} from 'node:fs/promises';
const {rooms}=JSON.parse(await readFile(new URL('../rooms.config.json',import.meta.url),'utf8'));
if(rooms.some(r=>r.password.startsWith('change-this-'))) {
  console.error('Before publishing, replace the example passwords in rooms.config.json with your own passwords.');
  process.exit(1);
}
