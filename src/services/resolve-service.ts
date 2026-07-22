import { normalizeName, resolveName } from "../domain/resolve";
import type { AliasRepo } from "../repositories/alias-repo";
import type { MemberRepo } from "../repositories/member-repo";

// A resolver with its lookup maps built once, then reused across many resolve() calls.
export type NameResolver = { resolve(rawName: string): number | null };

export class ResolveService {
  constructor(
    private readonly aliasRepo: AliasRepo,
    private readonly memberRepo: MemberRepo,
  ) {}

  // Loads aliases + members once and builds normalized lookup maps. Recompute calls resolve() per row
  // thousands of times, so the maps are built here exactly once and captured by the returned closure.
  async buildResolver(): Promise<NameResolver> {
    const [aliases, members] = await Promise.all([this.aliasRepo.list(), this.memberRepo.list()]);

    const aliasMap = new Map<string, number>();
    for (const alias of aliases) {
      aliasMap.set(normalizeName(alias.alias), alias.member_id);
    }

    const govMap = new Map<string, number>();
    for (const member of members) {
      govMap.set(normalizeName(member.governor), member.id);
    }

    return { resolve: (raw) => resolveName(raw, aliasMap, govMap) };
  }

  async resolve(rawName: string): Promise<number | null> {
    return (await this.buildResolver()).resolve(rawName);
  }
}
