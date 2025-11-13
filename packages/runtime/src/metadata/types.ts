/**
 * Common metadata interface for runtime APIs
 * Each runtime module exports its metadata for the type generator
 */

import { RuntimeAPIName } from "./generated";

export interface RuntimeAPIParam {
	name: string;
	type: string;
	description?: string;
	optional?: boolean;
}

export interface RuntimeAPIMethod {
	name: string;
	description: string;
	params: RuntimeAPIParam[];
	returns: string;
}

export interface RuntimeAPIMetadata {
	name: RuntimeAPIName;
	description: string;
	methods: RuntimeAPIMethod[];
}
