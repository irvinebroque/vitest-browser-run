export type ScenarioSurface = 'dashboard' | 'billing' | 'checkout' | 'admin' | 'settings' | 'audit-log';

export type ScenarioRole = 'owner' | 'admin' | 'billing' | 'viewer';

export type ScenarioLocale = 'en-US' | 'fr-FR' | 'ja-JP' | 'ar-EG';

export type ScenarioViewport = 'desktop' | 'mobile';

export interface Scenario {
	id: string;
	surface: ScenarioSurface;
	role: ScenarioRole;
	locale: ScenarioLocale;
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
}
