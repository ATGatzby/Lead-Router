import type { AgentContext } from "../types";

export interface FieldSyncResult {
  objectType: string;
  fieldsSynced: number;
}

export interface FieldSummary {
  id: string;
  objectType: string;
  apiName: string;
  label: string;
  fieldType: string;
}

export class FieldService {
  static async list(objectType: string | undefined, ctx: AgentContext): Promise<FieldSummary[]> {
    const where: any = { orgId: ctx.orgId };
    if (objectType) where.objectType = objectType;

    const fields = await ctx.prisma.fieldSchema.findMany({
      where,
      orderBy: [{ objectType: "asc" }, { fieldLabel: "asc" }],
    });

    return fields.map((f: any) => ({
      id: f.id,
      objectType: f.objectType,
      apiName: f.fieldApiName,
      label: f.fieldLabel,
      fieldType: f.fieldType,
    }));
  }

  static async sync(objectType: string, ctx: AgentContext): Promise<FieldSyncResult> {
    const count = await ctx.prisma.fieldSchema.count({
      where: { orgId: ctx.orgId, objectType: objectType as any },
    });

    return { objectType, fieldsSynced: count };
  }
}
