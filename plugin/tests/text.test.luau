-- 无头单元测试（用 Lune 跑）：验证 Text.luau 的纯逻辑——行拆分、行区间拼接、单表达式判断。
-- 这些是 edit_script_lines / run_luau 最易出 off-by-one / 误判的地方。
-- 运行：lune run plugin/tests/text.test.luau

local process = require("@lune/process")
local Text = require("../src/Text")

local pass, fail = 0, 0
local function check(name: string, cond: boolean)
	if cond then
		pass += 1
		print("  ok  - " .. name)
	else
		fail += 1
		print("  FAIL- " .. name)
	end
end

local function eq(a: { string }, b: { string }): boolean
	if #a ~= #b then
		return false
	end
	for i = 1, #a do
		if a[i] ~= b[i] then
			return false
		end
	end
	return true
end

-- splitLines
check("splitLines: three lines", eq(Text.splitLines("a\nb\nc"), { "a", "b", "c" }))
check("splitLines: keeps blank lines", eq(Text.splitLines("a\n\nc"), { "a", "", "c" }))
check("splitLines: empty string is one empty line", eq(Text.splitLines(""), { "" }))

local L = { "a", "b", "c", "d" }
-- splice replace
check("splice replace [2,3] with {X}", eq(Text.splice(L, 2, 3, "replace", { "X" }), { "a", "X", "d" }))
check("splice replace multi-line", eq(Text.splice(L, 2, 2, "replace", { "X", "Y" }), { "a", "X", "Y", "c", "d" }))
-- splice insert
check("splice insert before 2", eq(Text.splice(L, 2, 2, "insert", { "X" }), { "a", "X", "b", "c", "d" }))
check("splice insert at end (startLine = n+1)", eq(Text.splice(L, 5, 5, "insert", { "X" }), { "a", "b", "c", "d", "X" }))
-- splice delete
check("splice delete [2,3]", eq(Text.splice(L, 2, 3, "delete", nil), { "a", "d" }))
check("splice delete single line", eq(Text.splice(L, 1, 1, "delete", nil), { "b", "c", "d" }))

-- looksLikeStatements
check("looksLikeStatements: single expr is false", Text.looksLikeStatements("1 + 1") == false)
check("looksLikeStatements: field access is false", Text.looksLikeStatements("workspace.Name") == false)
check("looksLikeStatements: local is true", Text.looksLikeStatements("local x = 1") == true)
check("looksLikeStatements: return is true", Text.looksLikeStatements("return 5") == true)
check("looksLikeStatements: newline is true", Text.looksLikeStatements("local x = 1\nprint(x)") == true)
check("looksLikeStatements: semicolon is true", Text.looksLikeStatements("a(); b()") == true)

print(("\n%d passed, %d failed"):format(pass, fail))
if fail > 0 then
	process.exit(1)
end
