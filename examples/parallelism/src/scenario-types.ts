export type ScenarioSurface = 'dashboard' | 'billing' | 'checkout' | 'admin' | 'settings' | 'audit-log';

export type ScenarioRole = 'owner' | 'admin' | 'billing' | 'viewer';

export type ScenarioLocale = 'en-US' | 'fr-FR' | 'ja-JP' | 'ar-EG';

export type ScenarioViewport = 'desktop' | 'mobile';

export type ScenarioPlan = 'free' | 'pro' | 'enterprise';

export type ScenarioRegion = 'na' | 'eu' | 'apac' | 'mea';

export type ScenarioDataSize = 'empty' | 'standard' | 'large';

export type ScenarioFeatureState = 'control' | 'rollout' | 'beta';

export interface Scenario {
	dataSize?: ScenarioDataSize;
	featureState?: ScenarioFeatureState;
	id: string;
	surface: ScenarioSurface;
	role: ScenarioRole;
	locale: ScenarioLocale;
	plan?: ScenarioPlan;
	region?: ScenarioRegion;
	viewport: ScenarioViewport;
	flags: string[];
}

export interface ScenarioBootstrap {
	scenario: Scenario;
	title: string;
	formattedRevenue: string;
	primaryAction: string;
	guardrail: string;
	navigation: string[];
	planLabel: string;
	regionLabel: string;
	scaleLabel: string;
	stateLabel: string;
}
