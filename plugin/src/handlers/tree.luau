-- 数据模型读取 handler：get_tree / get_children / view_elements。

local Safety = require(script.Parent.Parent.Safety)
local Properties = require(script.Parent.properties)

local M = {}
local DEFAULT_TREE_NODES = 500
local MAX_TREE_NODES = 2_000
local DEFAULT_CHILDREN_LIMIT = 200
local MAX_CHILDREN_LIMIT = 500
local DEFAULT_ELEMENTS_LIMIT = 100
local MAX_ELEMENTS_LIMIT = 250

local function bounded(value: any, fallback: number, maximum: number): number
	local n = tonumber(value) or fallback
	return math.clamp(math.floor(n), 1, maximum)
end

local function isExcluded(inst: Instance, exclude: { string }?): boolean
	if not exclude then
		return false
	end
	for _, cls in ipairs(exclude) do
		if inst.ClassName == cls or inst:IsA(cls) then
			return true
		end
	end
	return false
end

-- ctr：共享计数器 { n = 已生成节点数, max = 上限或 math.huge, hit = 是否触顶 }。
local function nodeOf(inst: Instance, depth: number, maxDepth: number, whitelist: { string }?, exclude: { string }?, ctr: any)
	local children = {}
	if depth < maxDepth then
		for _, c in ipairs(inst:GetChildren()) do
			if ctr.n >= ctr.max then
				ctr.hit = true
				break
			end
			local include = (not whitelist or table.find(whitelist, c.ClassName)) and not isExcluded(c, exclude)
			if include then
				ctr.n += 1
				table.insert(children, nodeOf(c, depth + 1, maxDepth, whitelist, exclude, ctr))
			end
		end
	end
	return {
		name = inst.Name,
		className = inst.ClassName,
		path = Safety.pathOf(inst),
		childCount = #inst:GetChildren(),
		children = children,
	}
end

function M.get_tree(args: any)
	local root: Instance = if args.rootPath then Safety.resolveOrFail(args.rootPath) else game
	if root ~= game then
		Safety.assertReadable(root)
	end
	local maxDepth = bounded(args.maxDepth, 3, 8)
	local ctr = { n = 0, max = bounded(args.maxNodes, DEFAULT_TREE_NODES, MAX_TREE_NODES), hit = false }
	local tree = nodeOf(root, 0, maxDepth, args.classWhitelist, args.excludeClassWhitelist, ctr)
	return { root = tree, nodeCount = ctr.n, truncated = ctr.hit }
end

function M.get_children(args: any)
	local inst = Safety.resolveOrFail(args.path)
	Safety.assertReadable(inst)
	local limit = bounded(args.limit, DEFAULT_CHILDREN_LIMIT, MAX_CHILDREN_LIMIT)
	local cursor = math.max(tonumber(args.cursor) or 0, 0)
	local list = {}
	local seen = 0
	local truncated = false
	for _, c in ipairs(inst:GetChildren()) do
		seen += 1
		if seen <= cursor then
			continue
		end
		table.insert(list, {
			name = c.Name,
			className = c.ClassName,
			path = Safety.pathOf(c),
			childCount = #c:GetChildren(),
		})
		if #list >= limit then
			truncated = seen < #inst:GetChildren()
			break
		end
	end
	local result: { [string]: any } = { count = #list, children = list, truncated = truncated }
	if truncated then
		result.nextCursor = cursor + #list
	end
	return result
end

function M.view_elements(args: any)
	local limit = bounded(args.limit, DEFAULT_ELEMENTS_LIMIT, MAX_ELEMENTS_LIMIT)
	local cursor = math.max(tonumber(args.cursor) or 0, 0)
	local targets: { Instance } = {}
	local seen = 0
	local truncated = false
	if args.paths then
		for _, p in ipairs(args.paths) do
			seen += 1
			if seen <= cursor then
				continue
			end
			table.insert(targets, Safety.resolveOrFail(p))
			if #targets >= limit then
				truncated = seen < #args.paths
				break
			end
		end
	elseif args.classNameFilter then
		local root: Instance = if args.rootPath then Safety.resolveOrFail(args.rootPath) else game
		for _, d in ipairs(root:GetDescendants()) do
			if d.ClassName == args.classNameFilter or d:IsA(args.classNameFilter) then
				seen += 1
				if seen > cursor then
					table.insert(targets, d)
					if #targets >= limit then
						truncated = true
						break
					end
				end
			end
		end
	else
		Safety.fail("INVALID_ARGS", "Provide either paths or classNameFilter")
	end

	local out = {}
	for _, inst in ipairs(targets) do
		if pcall(Safety.assertReadable, inst) then
			local info = Properties.readProperties(inst, args.props)
			if args.includeSource and inst:IsA("LuaSourceContainer") then
				local oks, src = pcall(function()
					return (inst :: any).Source
				end)
				if oks then
					info.Source = src
				end
			end
			table.insert(out, info)
		end
	end
	local result: { [string]: any } = { count = #out, elements = out, truncated = truncated }
	if truncated then
		result.nextCursor = cursor + #out
	end
	return result
end

return M
