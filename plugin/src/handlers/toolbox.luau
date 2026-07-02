-- 素材库搜索 + 资源体检 + 查看当前选择。
-- 搜索用 InsertService:GetFreeModels/GetFreeDecals（Studio 内置，免登录、不走 HttpService），
-- 每条结果可选地把资源加载到临时容器里"体检"：是否含脚本、脚本名、零件数、类名分布、包围盒等。

local Safety = require(script.Parent.Parent.Safety)
local Properties = require(script.Parent.properties)
local InsertService = game:GetService("InsertService")
local Selection = game:GetService("Selection")

local M = {}

-- 分析一个容器（LoadAsset 返回的未父级化 Model）的内容。
local function analyze(container: Instance)
	local descendants = container:GetDescendants()
	local scriptNames = {}
	local scriptCount = 0
	local partCount = 0
	local classes: { [string]: number } = {}
	for _, d in ipairs(descendants) do
		classes[d.ClassName] = (classes[d.ClassName] or 0) + 1
		if d:IsA("LuaSourceContainer") then
			scriptCount += 1
			if #scriptNames < 25 then
				table.insert(scriptNames, d.ClassName .. " '" .. d.Name .. "'")
			end
		elseif d:IsA("BasePart") then
			partCount += 1
		end
	end
	-- 类名分布（按数量排序，取前若干）。
	local classList = {}
	for cls, n in pairs(classes) do
		table.insert(classList, { className = cls, count = n })
	end
	table.sort(classList, function(a, b)
		return a.count > b.count
	end)
	local topClasses = {}
	for i = 1, math.min(#classList, 10) do
		table.insert(topClasses, classList[i])
	end
	-- 包围盒大小（若容器像个 Model）。
	local size = nil
	pcall(function()
		if container:IsA("Model") then
			local s = (container :: Model):GetExtentsSize()
			size = { s.X, s.Y, s.Z }
		end
	end)
	return {
		hasScripts = scriptCount > 0,
		scriptCount = scriptCount,
		scriptNames = scriptNames,
		partCount = partCount,
		instanceCount = #descendants,
		classes = topClasses,
		size = size,
	}
end

-- 体检单个 assetId：加载→分析→销毁（不落场景）。
function M.inspect_asset(args: any)
	local assetId = tonumber(args.assetId) or 0
	local ok, container = pcall(function()
		return InsertService:LoadAsset(assetId)
	end)
	if not ok or not container then
		return { assetId = assetId, loaded = false, error = tostring(container) }
	end
	local info = analyze(container)
	container:Destroy()
	info.assetId = assetId
	info.loaded = true
	return info
end

-- 搜索免费素材（模型/贴图），可选地对每条结果做体检。
function M.toolbox_search(args: any)
	local query = args.query
	if not query or query == "" then
		Safety.fail("INVALID_ARGS", "query is required")
	end
	local category = args.category or "model"
	local page = tonumber(args.page) or 0
	local limit = tonumber(args.limit) or 10
	local doInspect = args.inspect ~= false

	local ok, collections = pcall(function()
		if category == "decal" then
			return InsertService:GetFreeDecals(query, page)
		end
		return InsertService:GetFreeModels(query, page)
	end)
	if not ok then
		Safety.fail(
			"SEARCH_FAILED",
			"InsertService free-" .. category .. " search failed (may be unavailable in this Studio build): " .. tostring(collections)
		)
	end

	-- 展平结果：GetFreeModels 返回若干集合，每个集合有 .Results。
	local flat = {}
	for _, coll in ipairs(collections or {}) do
		local items = coll.Results or coll
		if type(items) == "table" then
			for _, it in ipairs(items) do
				table.insert(flat, it)
			end
		end
	end

	local results = {}
	for _, it in ipairs(flat) do
		if #results >= limit then
			break
		end
		local assetId = it.AssetId or it.assetId
		local entry: { [string]: any } = {
			assetId = assetId,
			name = it.Name,
			creatorName = it.CreatorName,
			creatorId = it.CreatorID or it.CreatorId,
			assetType = category,
		}
		if doInspect and assetId then
			local info = M.inspect_asset({ assetId = assetId })
			entry.hasScripts = info.hasScripts
			entry.scriptCount = info.scriptCount
			entry.scriptNames = info.scriptNames
			entry.partCount = info.partCount
			entry.instanceCount = info.instanceCount
			entry.classes = info.classes
			entry.size = info.size
			entry.loaded = info.loaded
		end
		table.insert(results, entry)
	end

	return { query = query, category = category, page = page, inspected = doInspect, count = #results, results = results }
end

-- 查看当前 Studio 选择的元素（带详情：属性、是否含脚本等）。
function M.view_selection(args: any)
	local out = {}
	for _, inst in ipairs(Selection:Get()) do
		if pcall(Safety.assertReadable, inst) then
			local info = Properties.readProperties(inst, args and args.props)
			-- 是否含脚本（含自身/后代）。
			local scriptCount = 0
			for _, d in ipairs(inst:GetDescendants()) do
				if d:IsA("LuaSourceContainer") then
					scriptCount += 1
				end
			end
			if inst:IsA("LuaSourceContainer") then
				scriptCount += 1
			end
			info.hasScripts = scriptCount > 0
			info.scriptCount = scriptCount
			info.childCount = #inst:GetChildren()
			if args and args.includeSource and inst:IsA("LuaSourceContainer") then
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
	return { count = #out, selection = out }
end

return M
