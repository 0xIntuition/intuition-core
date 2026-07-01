export const KG_REF_TYPES = ['node', 'triple'] as const;

export type KgRefType = (typeof KG_REF_TYPES)[number];
export type KgRef = {
	refType: KgRefType;
	refId: string;
};
