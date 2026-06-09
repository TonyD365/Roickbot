-- 脚本源码读写 handler（用 ScriptEditorService）。

local Safety = require(script.Parent.Parent.Safety)
local ScriptEditorService = game:GetService("ScriptEditorService")

local M = {}

-- 读脚本源码（优先编辑器源，退回 .Source）。
local function readSource(inst: Instance): string?
	local ok, s = pcall(function()
		return ScriptEditorService:GetEditorSource(inst)
	end)
	if ok and s then
		return s
	end
	local ok2, s2 = pcall(function()
		return (inst :: any).Source
	end)
	if ok2 then
		return s2
	end
	return nil
end

function M.get_script_source(args: any)
	local inst = Safety.resolveOrFail(args.path)
	Safety.assertReadable(inst)
	if not inst:IsA("LuaSourceContainer") then
		Safety.fail("PROP_ERROR", "Not a script: " .. Safety.pathOf(inst))
	end
	local ok, src = pcall(function()
		return ScriptEditorService:GetEditorSource(inst)
	end)
	if not ok then
		local ok2, s2 = pcall(function()
			return (inst :: any).Source
		end)
		if not ok2 then
			Safety.fail("PROP_ERROR", "Cannot read script source")
		end
		src = s2
	end
	return { path = Safety.pathOf(inst), source = src }
end

function M.set_script_source(args: any, env: any)
	local inst = Safety.resolveOrFail(args.path)
	Safety.assertMutable(inst)
	if not inst:IsA("LuaSourceContainer") then
		Safety.fail("PROP_ERROR", "Not a script: " .. Safety.pathOf(inst))
	end
	-- UpdateSourceAsync 不一定被 ChangeHistory 的 Cancel 回滚，所以 dryRun 时直接不写。
	if env.dryRun then
		return { path = Safety.pathOf(inst), length = #args.source, dryRun = true, note = "Would replace script source" }
	end
	local ok, err = pcall(function()
		ScriptEditorService:UpdateSourceAsync(inst, function()
			return args.source
		end)
	end)
	if not ok then
		Safety.fail("PROP_ERROR", "UpdateSourceAsync failed: " .. tostring(err))
	end
	return { path = Safety.pathOf(inst), length = #args.source, dryRun = false }
end

-- grep：在所有脚本源码里搜文本，返回每个匹配脚本的行号 + 行文本。只读，运行时可用。
function M.search_scripts(args: any)
	local root: Instance = if args.rootPath then Safety.resolveOrFail(args.rootPath) else game
	if root ~= game then
		Safety.assertReadable(root)
	end
	if not args.query or args.query == "" then
		Safety.fail("INVALID_ARGS", "query is required")
	end
	local caseSensitive = args.caseSensitive == true
	local maxResults = args.maxResults or 200
	local needle = if caseSensitive then args.query else string.lower(args.query)

	local files = {}
	local total = 0
	local truncated = false
	for _, d in ipairs(root:GetDescendants()) do
		if total >= maxResults then
			truncated = true
			break
		end
		if d:IsA("LuaSourceContainer") and pcall(Safety.assertReadable, d) then
			local src = readSource(d)
			if src then
				local matches = {}
				local lineNo = 0
				for line in (src .. "\n"):gmatch("(.-)\n") do
					lineNo += 1
					local hay = if caseSensitive then line else string.lower(line)
					if string.find(hay, needle, 1, true) then
						table.insert(matches, { line = lineNo, text = line })
						total += 1
						if total >= maxResults then
							truncated = true
							break
						end
					end
				end
				if #matches > 0 then
					table.insert(files, { path = Safety.pathOf(d), className = d.ClassName, matches = matches })
				end
			end
		end
	end
	return { query = args.query, totalMatches = total, truncated = truncated, files = files }
end

-- 查看脚本"文件"的属性（不返回完整源码），便于调试为何没执行。
function M.get_script_info(args: any)
	local inst = Safety.resolveOrFail(args.path)
	Safety.assertReadable(inst)
	if not inst:IsA("LuaSourceContainer") then
		Safety.fail("PROP_ERROR", "Not a script: " .. Safety.pathOf(inst))
	end
	local src = readSource(inst)
	local lineCount = 0
	if src then
		for _ in (src .. "\n"):gmatch("(.-)\n") do
			lineCount += 1
		end
	end

	local info: { [string]: any } = {
		path = Safety.pathOf(inst),
		className = inst.ClassName,
		parent = if inst.Parent then Safety.pathOf(inst.Parent) else nil,
		lineCount = lineCount,
		charCount = if src then #src else 0,
		sourceAvailable = src ~= nil,
	}
	-- 这些属性不是所有脚本类都有，用 pcall 取。
	local function tryProp(name: string)
		local ok, v = pcall(function()
			return (inst :: any)[name]
		end)
		if ok then
			info[name] = if typeof(v) == "EnumItem" then v.Name else v
		end
	end
	tryProp("Enabled")
	tryProp("Disabled")
	tryProp("RunContext")

	-- Attributes 也一并带上（调试常用）。
	local attrs = {}
	for k, v in pairs(inst:GetAttributes()) do
		attrs[k] = if typeof(v) == "EnumItem" then v.Name else v
	end
	info.attributes = attrs
	return info
end

-- 把源码按换行拆成行（保留空行）。
local function splitLines(src: string): { string }
	local lines = {}
	for line in (src .. "\n"):gmatch("(.-)\n") do
		table.insert(lines, line)
	end
	return lines
end

-- 行级编辑：替换 / 插入 / 删除指定行区间，避免整源替换。
function M.edit_script_lines(args: any, env: any)
	local inst = Safety.resolveOrFail(args.path)
	Safety.assertMutable(inst)
	if not inst:IsA("LuaSourceContainer") then
		Safety.fail("PROP_ERROR", "Not a script: " .. Safety.pathOf(inst))
	end

	local src: string
	do
		local ok, s = pcall(function()
			return ScriptEditorService:GetEditorSource(inst)
		end)
		src = if ok then s else (inst :: any).Source
	end

	local lines = splitLines(src)
	local total = #lines
	local mode = args.mode or "replace"
	local startLine = args.startLine
	local endLine = args.endLine or startLine

	if startLine < 1 or startLine > total + 1 then
		Safety.fail("INVALID_ARGS", "startLine out of range (1.." .. (total + 1) .. ")")
	end
	if mode ~= "insert" and (endLine < startLine or endLine > total) then
		Safety.fail("INVALID_ARGS", "endLine out of range (" .. startLine .. ".." .. total .. ")")
	end

	local replacementLines = if args.replacement then splitLines(args.replacement) else {}

	local out = {}
	-- 头部：startLine 之前的行。
	for i = 1, startLine - 1 do
		table.insert(out, lines[i])
	end
	-- 中段：根据 mode 决定。
	if mode ~= "delete" then
		for _, l in ipairs(replacementLines) do
			table.insert(out, l)
		end
	end
	-- 尾部：insert 模式从 startLine 起保留；否则从 endLine+1 起。
	local resumeFrom = if mode == "insert" then startLine else endLine + 1
	for i = resumeFrom, total do
		table.insert(out, lines[i])
	end

	local newSource = table.concat(out, "\n")

	if env.dryRun then
		return {
			path = Safety.pathOf(inst),
			mode = mode,
			startLine = startLine,
			endLine = endLine,
			oldLineCount = total,
			newLineCount = #out,
			dryRun = true,
			note = "Would rewrite the script with the edited line range",
		}
	end

	local ok, err = pcall(function()
		ScriptEditorService:UpdateSourceAsync(inst, function()
			return newSource
		end)
	end)
	if not ok then
		Safety.fail("PROP_ERROR", "UpdateSourceAsync failed: " .. tostring(err))
	end
	return {
		path = Safety.pathOf(inst),
		mode = mode,
		startLine = startLine,
		endLine = endLine,
		oldLineCount = total,
		newLineCount = #out,
		dryRun = false,
	}
end

return M
