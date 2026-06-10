-- 数据模型读取 handler：get_tree / get_children / view_elements。

local Safety = require(script.Parent.Parent.Safety)
local Properties = require(script.Parent.properties)

local M = {}

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
	local maxDepth = args.maxDepth or 3
	local ctr = { n = 0, max = args.maxNodes or math.huge, hit = false }
	local tree = nodeOf(root, 0, maxDepth, args.classWhitelist, args.excludeClassWhitelist, ctr)
	return { root = tree, nodeCount = ctr.n, truncated = ctr.hit }
end

function M.get_children(args: any)
	local inst = Safety.resolveOrFail(args.path)
	Safety.assertReadable(inst)
	local list = {}
	for _, c in ipairs(inst:GetChildren()) do
		table.insert(list, {
			name = c.Name,
			className = c.ClassName,
			path = Safety.pathOf(c),
			childCount = #c:GetChildren(),
		})
	end
	return list
end

function M.view_elements(args: any)
	local targets: { Instance } = {}
	if args.paths then
		for _, p in ipairs(args.paths) do
			table.insert(targets, Safety.resolveOrFail(p))
		end
	elseif args.classNameFilter then
		local root: Instance = if args.rootPath then Safety.resolveOrFail(args.rootPath) else game
		for _, d in ipairs(root:GetDescendants()) do
			if d.ClassName == args.classNameFilter or d:IsA(args.classNameFilter) then
				table.insert(targets, d)
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
	return { count = #out, elements = out }
end

return M
