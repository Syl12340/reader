import { writable } from 'svelte/store';
import { notify } from './interaction';

type CommandHandler = () => void | Promise<void>;
export interface CommandDescriptor {
  label?: string;
  enabled?: () => boolean;
  checked?: () => boolean;
  unavailable?: string;
}
export const commandRevision = writable(0);

class CommandManager {
  private handlers = new Map<string, CommandHandler>();
  private descriptors = new Map<string, CommandDescriptor>();

  register(id: string, handler: CommandHandler, descriptor: CommandDescriptor = {}): () => void {
    this.handlers.set(id, handler);
    this.descriptors.set(id, descriptor);
    commandRevision.update(value => value + 1);
    return () => {
      if (this.handlers.get(id) === handler) {
        this.handlers.delete(id);
        this.descriptors.delete(id);
        commandRevision.update(value => value + 1);
      }
    };
  }

  describe(id: string) {
    const descriptor = this.descriptors.get(id);
    return { id, label: descriptor?.label ?? id, enabled: this.handlers.has(id) && (descriptor?.enabled?.() ?? true),
      checked: descriptor?.checked?.(), unavailable: descriptor?.unavailable ?? '当前状态下无法执行此操作。' };
  }

  async execute(id: string): Promise<void> {
    const handler = this.handlers.get(id);
    const descriptor = this.describe(id);
    if (!handler || !descriptor.enabled) {
      notify(descriptor.unavailable, undefined, false);
      return;
    }
    try { await handler(); }
    catch (error) {
      console.error(`Command failed: ${id}`, error);
      notify(`操作失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export const CommandService = new CommandManager();
