// Conventional commits, as in PushBased's other repos (push-based/zod2nx-schema). nx release reads
// these to pick the next version and write the changelog: `feat` bumps the minor, `fix` the patch.
import config from '@commitlint/config-conventional';
import nxScopes from '@commitlint/config-nx-scopes';
import {RuleConfigSeverity} from '@commitlint/types';

/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  plugins: ['commitlint-plugin-tense'],
  rules: {
    // The workspace's projects (vite-plugin-ngp, create-ngp, playground, site), plus the parts that
    // aren't one. A package's project name is the `nx.name` in its package.json.
    'scope-enum': async (ctx) => {
      const projects = nxScopes.utils.getProjects(ctx);
      const scopes = [...projects, 'bench', 'toolchain', 'workflows'].sort();
      return [RuleConfigSeverity.Error, 'always', scopes];
    },
    // `release` is the type of the commit nx release makes.
    'type-enum': () => {
      const types = [...config.rules['type-enum'][2], 'release'];
      return [RuleConfigSeverity.Error, 'always', types];
    },
    'tense/subject-tense': [
      RuleConfigSeverity.Error,
      'always',
      {firstOnly: true, allowedTenses: ['present-imperative']},
    ],
  },
};
