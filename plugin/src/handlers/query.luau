-- 搜索 + CollectionService 标签 handler。
--   find_instances / search_by_property / get_tagged / get_tags / add_tag / remove_tag

local Safety = require(script.Parent.Parent.Safety)
local CollectionService = game:GetService("CollectionService")

local M = {}

local DEFAULT_LIMIT = 200

local function summarize(inst: Instance)
	return {
		name = inst.Name,
		className = inst.ClassName,
		path = Safety.pathOf(inst),
	}
end

-- 按名称 / 类名搜索实例。
function M.find_instances(args: any)
	local root: Instance = if args.rootPath then Safety.resolveOrFail(args.rootPath) else game
	if root ~= game then
		Safety.assertReadable(root)
	end
	local name = args.name
	local className = args.className
	local matchMode = args.matchMode or "contains"
	local caseSensitive = args.caseSensitive == true
	local limit = args.limit or DEFAULT_LIMIT

	if not name and not className then
		Safety.fail("INVALID_ARGS", "Provide name and/or className")
	end

	local needle = name
	if name and not caseSensitive then
		needle = string.lower(name)
	end

	local out = {}
	local truncated = false
	for _, d in ipairs(root:GetDescendants()) do
		local nameOk = true
		if name then
			local hay = if caseSensitive then d.Name else string.lower(d.Name)
			if matchMode == "exact" then
				nameOk = hay == needle
			else
				nameOk = string.find(hay, needle, 1, true) ~= nil
			end
		end
		local classOk = true
		if className then
			local ok, isa = pcall(function()
				return d:IsA(className)
			end)
			classOk = ok and isa or d.ClassName == className
		end
		if nameOk and classOk then
			table.insert(out, summarize(d))
			if #out >= limit then
				truncated = true
				break
			end
		end
	end
	return { count = #out, truncated = truncated, results = out }
end

-- 按属性值搜索实例（值按字符串比较）。
function M.search_by_property(args: any)
	local root: Instance = if args.rootPath then Safety.resolveOrFail(args.rootPath) else game
	if root ~= game then
		Safety.assertReadable(root)
	end
	local prop = args.property
	if not prop then
		Safety.fail("INVALID_ARGS", "property is required")
	end
	local op = args.op or "equals"
	local className = args.className
	local limit = args.limit or DEFAULT_LIMIT
	local want = tostring(args.value)

	local out = {}
	local truncated = false
	for _, d in ipairs(root:GetDescendants()) do
		local classOk = true
		if className then
			local ok, isa = pcall(function()
				return d:IsA(className)
			end)
			classOk = ok and isa or d.ClassName == className
		end
		if classOk then
			local ok, v = pcall(function()
				return (d :: any)[prop]
			end)
			if ok then
				local got = tostring(v)
				local hit = if op == "contains" then string.find(got, want, 1, true) ~= nil else got == want
				if hit then
					local entry = summarize(d)
					entry.value = got
					table.insert(out, entry)
					if #out >= limit then
						truncated = true
						break
					end
				end
			end
		end
	end
	return { count = #out, truncated = truncated, property = prop, results = out }
end

-- 取带某 tag 的所有实例。
function M.get_tagged(args: any)
	if not args.tag then
		Safety.fail("INVALID_ARGS", "tag is required")
	end
	local out = {}
	for _, inst in ipairs(CollectionService:GetTagged(args.tag)) do
		if pcall(Safety.assertReadable, inst) then
			table.insert(out, summarize(inst))
		end
	end
	return { tag = args.tag, count = #out, results = out }
end

-- 取某实例的所有 tag。
function M.get_tags(args: any)
	local inst = Safety.resolveOrFail(args.path)
	Safety.assertReadable(inst)
	return { path = Safety.pathOf(inst), tags = CollectionService:GetTags(inst) }
end

-- 给实例加 tag。
function M.add_tag(args: any, env: any)
	local inst = Safety.resolveOrFail(args.path)
	Safety.assertMutable(inst)
	if not args.tag then
		Safety.fail("INVALID_ARGS", "tag is required")
	end
	if not env.dryRun then
		CollectionService:AddTag(inst, args.tag)
	end
	return { path = Safety.pathOf(inst), tag = args.tag, added = not env.dryRun, dryRun = env.dryRun }
end

-- 移除实例的 tag。
function M.remove_tag(args: any, env: any)
	local inst = Safety.resolveOrFail(args.path)
	Safety.assertMutable(inst)
	if not args.tag then
		Safety.fail("INVALID_ARGS", "tag is required")
	end
	if not env.dryRun then
		CollectionService:RemoveTag(inst, args.tag)
	end
	return { path = Safety.pathOf(inst), tag = args.tag, removed = not env.dryRun, dryRun = env.dryRun }
end

return M
