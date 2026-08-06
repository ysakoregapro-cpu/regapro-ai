import type { Repository } from "./repositories.js";

type WithDeletedAt = { deletedAt?: string | null };

export class InMemoryRepository<T extends { id: string } & WithDeletedAt>
  implements Repository<T>
{
  private readonly store = new Map<string, T>();

  constructor(initial: T[] = []) {
    for (const item of initial) {
      this.store.set(item.id, item);
    }
  }

  async findById(id: string): Promise<T | null> {
    const item = this.store.get(id);
    if (!item || item.deletedAt) return null;
    return item;
  }

  async list(): Promise<T[]> {
    return [...this.store.values()].filter((item) => !item.deletedAt);
  }

  async create(entity: T): Promise<T> {
    this.store.set(entity.id, entity);
    return entity;
  }

  async update(id: string, patch: Partial<T>): Promise<T | null> {
    const existing = this.store.get(id);
    if (!existing || existing.deletedAt) return null;
    const updated = { ...existing, ...patch, id: existing.id };
    this.store.set(id, updated);
    return updated;
  }

  async softDelete(id: string): Promise<boolean> {
    const existing = this.store.get(id);
    if (!existing || existing.deletedAt) return false;
    existing.deletedAt = new Date().toISOString();
    this.store.set(id, existing);
    return true;
  }
}
