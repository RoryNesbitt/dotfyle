import type { NeovimConfig, NeovimPluginManager } from '@prisma/client';
import { prismaClient } from '../client';
import { paginator } from '../pagination';
import type {
	CreateNeovimConfigDTO,
	NeovimConfigWithMetaData,
	NeovimConfigWithPlugins,
	NeovimConfigWithToken,
	NestedNeovimConfigWithMetaData,
	NestedNeovimConfigWithPlugins
} from './schema';

const sortings = {
	plugins: {
		neovimConfigPlugins: {
			_count: 'desc'
		}
	},
	new: {
		createdAt: 'desc'
	},
	stars: [
		{
			stars: 'desc'
		},
		{
			repo: 'asc'
		},
		{
			root: 'asc'
		}
	]
} as const;

export async function getConfigsWithToken(): Promise<NeovimConfigWithToken[]> {
	const configs = await prismaClient.neovimConfig.findMany({
		include: {
			user: {
				select: {
					githubToken: {
						select: {
							accessToken: true
						}
					}
				}
			}
		}
	});
	return configs
		.map(({ user, ...config }) => {
			return {
				...config,
				_token: user.githubToken?.accessToken
			};
		})
		.filter((c) => !!c._token) as NeovimConfigWithToken[];
}

export async function getConfigsForPlugin(
	owner: string,
	name: string,
	take: number
): Promise<NeovimConfigWithMetaData[]> {
	const configs = await prismaClient.neovimConfig.findMany({
		include: {
			user: {
				select: {
					avatarUrl: true
				}
			},
			_count: {
				select: {
					neovimConfigPlugins: true
				}
			}
		},
		where: {
			neovimConfigPlugins: {
				some: {
					plugin: {
						owner,
						name
					}
				}
			}
		},
		orderBy: [
			{
				stars: 'desc'
			},
			{
				repo: 'asc'
			},
			{
				root: 'asc'
			}
		],
		take
	});
	return configs.map(attachMetaData);
}

export async function getConfigBySlug(
	owner: string,
	slug: string
): Promise<NeovimConfigWithMetaData> {
	const config = await prismaClient.neovimConfig.findFirstOrThrow({
		include: {
			user: {
				select: {
					avatarUrl: true
				}
			},
			_count: {
				select: {
					neovimConfigPlugins: true
				}
			}
		},
		where: {
			slug,
			user: {
				username: owner
			}
		},
		orderBy: [
			{
				stars: 'desc'
			},
			{
				repo: 'asc'
			},
			{
				root: 'asc'
			}
		]
	});
	return attachMetaData(config);
}

export async function getConfigsByUsername(username: string): Promise<NeovimConfigWithMetaData[]> {
	const configs = await prismaClient.neovimConfig.findMany({
		include: {
			user: { select: { avatarUrl: true } },
			_count: {
				select: {
					neovimConfigPlugins: true
				}
			}
		},
		where: { user: { username } },
		orderBy: [{ stars: 'desc' }, { repo: 'asc' }, { root: 'asc' }]
	});
	return configs.map(attachMetaData);
}
export async function upsertNeovimConfig(
	userId: number,
	config: CreateNeovimConfigDTO
): Promise<NeovimConfig> {
	const lastSyncedAt = new Date();
	const { owner, repo, root } = config;
	const data = { userId, lastSyncedAt, ...config };
	const user = await prismaClient.neovimConfig.upsert({
		where: { owner_repo_root: { owner, repo, root } },
		create: data,
		update: data
	});
	return user;
}

export async function updatePluginManager(
	id: number,
	pluginManager: NeovimPluginManager
): Promise<NeovimConfig> {
	const config = await prismaClient.neovimConfig.update({ where: { id }, data: { pluginManager } });
	return config;
}

export async function getConfigWithPlugins(id: number): Promise<NeovimConfigWithPlugins> {
	const config = await prismaClient.neovimConfig.findUniqueOrThrow({
		where: {
			id
		},
		include: {
			neovimConfigPlugins: {
				include: {
					plugin: true
				}
			}
		}
	});
	return attachPlugins(config);
}

export async function syncLanguageServers(id: number, sha: string, languageServers: string[]) {
	await prismaClient.neovimConfig.update({
		where: {
			id
		},
		data: {
			languageServerMappings: {
				deleteMany: {
					languageServerName: {
						notIn: languageServers
					}
				},
				connectOrCreate: languageServers.map((languageServerName) => {
					return {
						where: {
							languageServerName_configId: {
								configId: id,
								languageServerName
							}
						},
						create: {
							languageServer: {
								connectOrCreate: {
									where: {
										name: languageServerName
									},
									create: {
										name: languageServerName
									}
								}
							},
							sync: {
								connectOrCreate: {
									where: {
										configId_sha: {
											configId: id,
											sha
										}
									},
									create: {
										sha,
										config: {
											connect: {
												id
											}
										}
									}
								}
							}
						}
					};
				})
			}
		}
	});
}

export async function syncConfigPlugins(
	configId: number,
	sha: string,
	pluginIds: number[]
): Promise<NeovimConfigWithPlugins> {
	const connectOrCreate = pluginIds.map((pluginId) => ({
		where: {
			configId_pluginId: {
				configId,
				pluginId
			}
		},
		create: {
			plugin: {
				connect: {
					id: pluginId
				}
			},
			sync: {
				connectOrCreate: {
					where: {
						configId_sha: {
							configId,
							sha
						}
					},
					create: {
						sha,
						config: {
							connect: {
								id: configId
							}
						}
					}
				}
			}
		}
	}));
	return await prismaClient.neovimConfig
		.update({
			include: {
				neovimConfigPlugins: {
					include: {
						plugin: true
					}
				}
			},
			where: { id: configId },
			data: {
				neovimConfigPlugins: {
					connectOrCreate,
					deleteMany: {
						configId,
						pluginId: {
							notIn: pluginIds
						}
					}
				}
			}
		})
		.then(attachPlugins);
}

export async function saveLeaderkey(id: number, leaderkey: string): Promise<NeovimConfig> {
	return await prismaClient.neovimConfig.update({
		where: {
			id
		},
		data: {
			leaderkey
		}
	});
}

export type ConfigSearchOptions = {
	query?: string | undefined;
	plugins?: string[];
	languageServers?: string[];
	sorting: 'new' | 'stars' | 'plugins';
	page?: number;
	take?: number;
};

export async function searchNeovimConfigs({
	query,
	plugins,
  languageServers,
	sorting,
	page,
	take
}: ConfigSearchOptions) {
	const queries = query?.split('/');
	const mode = 'insensitive';
	const args = {
		where: {
			...(query && queries
				? queries.length > 1
					? {
							AND: [
								{ owner: { contains: queries[0], mode } },
								{ repo: { contains: queries[1], mode } }
							]
					  }
					: {
							OR: [{ owner: { contains: query, mode } }, { repo: { contains: query, mode } }]
					  }
				: {}),
			...(plugins && plugins.length > 0
				? {
						AND: plugins.map((identifier) => {
							const [owner, name] = identifier.split('/');
							return {
								neovimConfigPlugins: {
									some: {
										plugin: {
											owner,
											name
										}
									}
								}
							};
						})
				  }
				: {}),
			...(languageServers && languageServers.length > 0
				? {
						AND: languageServers.map((languageServerName) => {
							return {
								languageServerMappings: {
									some: {
                    languageServerName
									}
								}
							};
						})
				  }
				: {})
		},
		include: {
			user: {
				select: {
					avatarUrl: true
				}
			},
			_count: {
				select: {
					neovimConfigPlugins: true
				}
			}
		},
		orderBy: sortings[sorting]
	};

	const { data: nestedConfigData, meta } = await paginator({
		perPage: take
	})<NestedNeovimConfigWithMetaData>(prismaClient.neovimConfig, args, { page });
	const data = nestedConfigData.map(attachMetaData);
	return {
		data,
		meta
	};
}

export async function getNewestNeovimConfigs(): Promise<NeovimConfigWithMetaData[]> {
	const configs = await prismaClient.neovimConfig.findMany({
		include: {
			user: {
				select: {
					avatarUrl: true
				}
			},
			_count: {
				select: {
					neovimConfigPlugins: true
				}
			}
		},
		orderBy: {
			createdAt: 'desc'
		},
		take: 6
	});

	return configs.map(attachMetaData);
}

function attachMetaData({
	_count,
	user,
	...config
}: NestedNeovimConfigWithMetaData): NeovimConfigWithMetaData {
	return {
		...config,
		ownerAvatar: user.avatarUrl,
		pluginCount: _count.neovimConfigPlugins
	};
}

function attachPlugins({
	neovimConfigPlugins,
	...config
}: NestedNeovimConfigWithPlugins): NeovimConfigWithPlugins {
	return {
		...config,
		plugins: neovimConfigPlugins.map((p) => p.plugin)
	};
}

export async function getNeovimConfigsWithDotfyleShield() {
	const nestedConfigs = await prismaClient.neovimConfig.findMany({
		where: {
			dotfyleShieldAddedAt: {
				not: null
			}
		},
		include: {
			user: {
				select: {
					avatarUrl: true
				}
			},
			_count: {
				select: {
					neovimConfigPlugins: true
				}
			}
		},
		orderBy: {
			dotfyleShieldAddedAt: 'desc'
		},
    take: 9,
	});

	return nestedConfigs.map(attachMetaData);
}
