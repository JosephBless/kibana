/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */
import dedent from 'dedent';
import { existsSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { spawn } from '../child_process';
import { log } from '../log';

async function isVaultAvailable() {
  try {
    await spawn('vault', ['--version'], { stdio: 'pipe' });

    return true;
  } catch {
    return false;
  }
}

async function isElasticCommitter() {
  try {
    const { stdout: email } = await spawn('git', ['config', 'user.email'], {
      stdio: 'pipe',
    });

    return email.trim().endsWith('@elastic.co');
  } catch {
    return false;
  }
}

export async function setupRemoteCache(repoRootPath: string) {
  // The remote cache is only for Elastic employees working locally (CI cache settings are handled elsewhere)
  if (process.env.CI || !(await isElasticCommitter())) {
    return;
  }

  log.debug(`[bazel_tools] setting up remote cache settings if necessary`);

  const settingsPath = resolve(repoRootPath, '.bazelrc.cache');

  if (existsSync(settingsPath)) {
    log.debug(`[bazel_tools] remote cache settings already exist, skipping`);
    return;
  }

  if (!(await isVaultAvailable())) {
    log.info('[bazel_tools] vault is not available, unable to setup remote cache settings.');
    log.info('[bazel_tools] building packages will work, but will be slower in many cases.');
    log.info('[bazel_tools] reach out to Operations if you need assistance with this.');
    return;
  }

  let apiKey = '';

  try {
    const { stdout } = await spawn(
      'vault',
      ['read', '-field=readonly-key', 'secret/ui-team/kibana-bazel-remote-cache'],
      {
        stdio: 'pipe',
      }
    );
    apiKey = stdout.trim();
  } catch (ex: unknown) {
    log.info(
      '[bazel_tools] unable to read bazel remote cache key from vault, are you authenticated?'
    );
    log.info('[bazel_tools] building packages will work, but will be slower in many cases.');
    log.info('[bazel_tools] reach out to Operations if you need assistance with this.');
    log.info(`[bazel_tools] ${ex}`);

    return;
  }

  const contents = dedent`
    # V1 - This file is automatically generated by 'yarn kbn bootstrap'
    # To regenerate this file, delete it and run 'yarn kbn bootstrap' again.
    build --bes_results_url=https://app.buildbuddy.io/invocation/
    build --bes_backend=grpcs://cloud.buildbuddy.io
    build --remote_cache=grpcs://cloud.buildbuddy.io
    build --remote_timeout=3600
    build --remote_header=${apiKey}
  `;

  writeFileSync(settingsPath, contents);
  log.info(`[bazel_tools] remote cache settings written to ${settingsPath}`);
}
