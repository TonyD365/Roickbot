-- 纯文本工具（无 Roblox 依赖），便于在 CI 里用 Lune 做无头单元测试。
-- edit_script_lines / run_luau 的易错逻辑（行拆分、行区间拼接、单表达式判断）都在这里。

local Text = {}

-- 按 \n 把源码拆成行（保留空行；末尾无换行也算一行）。
function Text.splitLines(src: string): { string }
	local lines = {}
	for line in (src .. "\n"):gmatch("(.-)\n") do
		table.insert(lines, line)
	end
	return lines
end

-- 对 lines 的 [startLine, endLine] 区间做 replace / insert / delete，返回新行数组。
-- 约定（1-based）：insert 在 startLine 之前插入、不删除；replace/delete 移除 [startLine,endLine]。
-- 越界检查由调用方负责。
function Text.splice(
	lines: { string },
	startLine: number,
	endLine: number,
	mode: string,
	replacement: { string }?
): { string }
	local out = {}
	for i = 1, startLine - 1 do
		table.insert(out, lines[i])
	end
	if mode ~= "delete" and replacement then
		for _, l in ipairs(replacement) do
			table.insert(out, l)
		end
	end
	local resumeFrom = if mode == "insert" then startLine else endLine + 1
	for i = resumeFrom, #lines do
		table.insert(out, lines[i])
	end
	return out
end

-- 是否像"语句块"（多语句/以语句关键字开头）。用于 returnExpression 只对单表达式自动包 return。
function Text.looksLikeStatements(src: string): boolean
	if string.find(src, "[\n;]") then
		return true
	end
	local trimmed = (string.gsub(src, "^%s+", ""))
	for _, kw in ipairs({ "local", "return", "for", "while", "if", "do", "function", "repeat" }) do
		if string.sub(trimmed, 1, #kw + 1) == kw .. " " or trimmed == kw then
			return true
		end
	end
	return false
end

return Text
