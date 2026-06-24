import type { ElfariaClient } from '../client.js';
import type { Command } from '../lib/types.js';
import { admin } from './admin.js';
import { autoplay } from './autoplay.js';
import { clear } from './clear.js';
import { dequeue } from './dequeue.js';
import { favorites } from './favorites.js';
import { filter } from './filter.js';
import { filtersave } from './filtersave.js';
import { forgetme } from './forgetme.js';
import { help } from './help.js';
import { history } from './history.js';
import { lofi } from './lofi.js';
import { loop } from './loop.js';
import { lyrics } from './lyrics.js';
import { move } from './move.js';
import { nowplaying } from './nowplaying.js';
import { pause } from './pause.js';
import { ping } from './ping.js';
import { play } from './play.js';
import { playlist } from './playlist.js';
import { queue } from './queue.js';
import { remove } from './remove.js';
import { replay } from './replay.js';
import { reroll } from './reroll.js';
import { resume } from './resume.js';
import { seek } from './seek.js';
import { settings } from './settings.js';
import { shuffle } from './shuffle.js';
import { skip } from './skip.js';
import { skipto } from './skipto.js';
import { status } from './status.js';
import { stop } from './stop.js';
import { summon } from './summon.js';
import { twentyfourseven } from './twentyfourseven.js';
import { volume } from './volume.js';

/**
 * The command registry (doc §2). An explicit array — type-safe and trivial to
 * audit — rather than filesystem scanning. Add a command by importing it here.
 */
export const commands: Command[] = [
  ping,
  play,
  skip,
  skipto,
  stop,
  pause,
  resume,
  queue,
  nowplaying,
  volume,
  loop,
  shuffle,
  seek,
  clear,
  move,
  remove,
  summon,
  settings,
  playlist,
  autoplay,
  reroll,
  dequeue,
  lofi,
  twentyfourseven,
  filter,
  filtersave,
  status,
  history,
  replay,
  favorites,
  lyrics,
  forgetme,
  admin,
  help,
];

/** Populate the client's command Collection used by the router. */
export function loadCommands(client: ElfariaClient): void {
  for (const command of commands) {
    client.commands.set(command.data.name, command);
  }
}
