type CommandHandler = () => void | Promise<void>;

class CommandManager {
  private handlers = new Map<string, CommandHandler>();

  register(id: string, handler: CommandHandler): () => void {
    this.handlers.set(id, handler);
    return () => {
      if (this.handlers.get(id) === handler) this.handlers.delete(id);
    };
  }

  async execute(id: string): Promise<void> {
    const handler = this.handlers.get(id);
    if (!handler) {
      console.warn(`Command is not available: ${id}`);
      return;
    }
    await handler();
  }
}

export const CommandService = new CommandManager();
