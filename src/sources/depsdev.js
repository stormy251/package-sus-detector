const SYS = { npm: 'npm', pypi: 'pypi' };
const enc = encodeURIComponent;

/** All versions with publish dates (used for first-publish date, version count and existence of a version). */
export async function depsdevPackage(http, { ecosystem, name }) {
    const { data, status } = await http.request(`https://api.deps.dev/v3/systems/${SYS[ecosystem]}/packages/${enc(name)}`);
    if (!data) return { found: false, status };
    const versions = (data.versions || []).map((v) => ({ version: v.versionKey.version, publishedAt: v.publishedAt || null, isDefault: !!v.isDefault, isDeprecated: !!v.isDeprecated }));
    return { found: true, versions };
}

/** Version-level facts: licences, advisory ids, deprecation, linked source project. */
export async function depsdevVersion(http, { ecosystem, name, version }) {
    const { data } = await http.request(`https://api.deps.dev/v3/systems/${SYS[ecosystem]}/packages/${enc(name)}/versions/${enc(version)}`);
    if (!data) return null;
    const project = (data.relatedProjects || []).find((p) => p.relationType === 'SOURCE_REPO')?.projectKey?.id || null;
    return {
        licenses: data.licenses || [],
        advisoryCount: (data.advisoryKeys || []).length,
        isDeprecated: !!data.isDeprecated,
        deprecatedReason: data.deprecatedReason || null,
        projectStatus: data.projectStatus?.status || null,
        sourceProject: project,
        publishedAt: data.publishedAt || null,
        slsaProvenance: (data.slsaProvenances || []).length > 0,
        attestations: (data.attestations || []).length > 0,
    };
}

/** OpenSSF Scorecard summary for a source project (optional, one extra request). */
export async function depsdevScorecard(http, projectId) {
    const { data } = await http.request(`https://api.deps.dev/v3/projects/${enc(projectId)}`);
    if (!data) return null;
    return {
        project: projectId,
        stars: data.starsCount ?? null,
        forks: data.forksCount ?? null,
        openIssues: data.openIssuesCount ?? null,
        scorecardOverall: data.scorecard?.overallScore ?? null,
        scorecardDate: data.scorecard?.date ?? null,
    };
}
