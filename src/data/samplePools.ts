export interface SampleResource {
  resourceType: string;
  profile: string;
  data: Record<string, string>;
}

export interface SamplePool {
  id: string;
  label: string;
  description: string;
  resources: SampleResource[];
}

export interface SamplePoolsConfig {
  pools: SamplePool[];
}

let cached: SamplePoolsConfig | null = null;

export async function loadSamplePools(): Promise<SamplePoolsConfig> {
  if (cached) return cached;
  const res = await fetch('/data/sample-pools.json');
  cached = await res.json();
  return cached!;
}

export function getSamplePoolIds(config: SamplePoolsConfig): string[] {
  return config.pools.map(p => p.id);
}
