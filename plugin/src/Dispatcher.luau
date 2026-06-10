-- 命令分发：把 tool 名映射到 handler，并用 ChangeHistoryService 包裹变更（支持撤销 + dryRun 回滚）。

local ChangeHistoryService = game:GetService("ChangeHistoryService")
local RunService = game:GetService("RunService")

local tree = require(script.Parent.handlers.tree)
local instances = require(script.Parent.handlers.instances)
local properties = require(script.Parent.handlers.properties)
local scripts = require(script.Parent.handlers.scripts)
local selection = require(script.Parent.handlers.selection)
local run = require(script.Parent.handlers.run)
local runLuau = require(script.Parent.handlers.runLuau)
local graphics = require(script.Parent.handlers.graphics)
local console = require(script.Parent.handlers.console)
local bot = require(script.Parent.handlers.bot)
local query = require(script.Parent.handlers.query)

local Dispatcher = {}

-- 工具名 -> handler 函数。
local handlers: { [string]: (any, any) -> any } = {
	-- 读取
	get_tree = tree.get_tree,
	get_children = tree.get_children,
	view_elements = tree.view_elements,
	get_properties = properties.get_properties,
	get_script_source = scripts.get_script_source,
	search_scripts = scripts.search_scripts,
	get_script_info = scripts.get_script_info,
	get_selection = selection.get_selection,
	get_run_state = run.get_run_state,
	get_console_output = console.get_console_output,
	bot_state = bot.bot_state,
	bot_see = bot.bot_see,
	-- 搜索 / 标签（读取）
	find_instances = query.find_instances,
	search_by_property = query.search_by_property,
	get_tagged = query.get_tagged,
	get_tags = query.get_tags,
	-- 变更
	set_properties = properties.set_properties,
	create_instance = instances.create_instance,
	delete_instance = instances.delete_instance,
	clone_instance = instances.clone_instance,
	reparent_instance = instances.reparent_instance,
	set_script_source = scripts.set_script_source,
	edit_script_lines = scripts.edit_script_lines,
	add_tag = query.add_tag,
	remove_tag = query.remove_tag,
	set_selection = selection.set_selection,
	run_luau = runLuau.run_luau,
	-- 运行 / 测试
	start_test = run.start_test,
	stop_test = run.stop_test,
	pause_test = run.pause_test,
	-- 做图（Phase 2）
	build_parts = graphics.build_parts,
	set_appearance = graphics.set_appearance,
	edit_terrain = graphics.edit_terrain,
	set_lighting = graphics.set_lighting,
	insert_decal = graphics.insert_decal,
	insert_model = graphics.insert_model,
	build_gui = graphics.build_gui,
	-- Bot（Phase 3，控制类，不受运行时锁限制）
	bot_spawn = bot.bot_spawn,
	bot_despawn = bot.bot_despawn,
	bot_move = bot.bot_move,
	bot_look = bot.bot_look,
}

-- 需要包 ChangeHistory 录制（可撤销 / dryRun 可回滚）的工具。
local MUTATING: { [string]: boolean } = {
	set_properties = true,
	create_instance = true,
	delete_instance = true,
	clone_instance = true,
	reparent_instance = true,
	set_script_source = true,
	edit_script_lines = true,
	add_tag = true,
	remove_tag = true,
	run_luau = true,
	build_parts = true,
	set_appearance = true,
	edit_terrain = true,
	set_lighting = true,
	insert_decal = true,
	insert_model = true,
	build_gui = true,
	-- Bot 的增删也录制（便于编辑态 Ctrl+Z）。
	bot_spawn = true,
	bot_despawn = true,
}

-- 游戏运行时禁止的"工程编辑"工具（= 编辑类，不含 run_luau，也不含 bot_* 控制工具）。
-- 运行态应只读观察；run_luau 作为运行期逃生舱保留，Bot 控制是测试手段故放行。
local LOCK_WHILE_RUNNING: { [string]: boolean } = {
	set_properties = true,
	create_instance = true,
	delete_instance = true,
	clone_instance = true,
	reparent_instance = true,
	set_script_source = true,
	edit_script_lines = true,
	add_tag = true,
	remove_tag = true,
	set_selection = true,
	build_parts = true,
	set_appearance = true,
	edit_terrain = true,
	set_lighting = true,
	insert_decal = true,
	insert_model = true,
	build_gui = true,
}

-- 当前插件实现的所有工具名（handshake 时上报给服务器，用于检测版本不一致）。
function Dispatcher.toolNames(): { string }
	local names = {}
	for name in pairs(handlers) do
		table.insert(names, name)
	end
	return names
end

function Dispatcher.dispatch(env: any): any
	local response: { [string]: any } = { id = env.id }
	local handler = handlers[env.tool]
	if not handler then
		response.ok = false
		response.error = {
			code = "UNKNOWN_TOOL",
			message = "This Studio plugin has no handler for '"
				.. tostring(env.tool)
				.. "'. The installed plugin is likely older than the desktop app — reinstall it via the app's "
				.. "'Install plugin' button, then reconnect in Studio.",
		}
		return response
	end

	-- 运行时锁：游戏在跑时禁止一切工程编辑（只读观察）。
	if LOCK_WHILE_RUNNING[env.tool] and RunService:IsRunning() then
		response.ok = false
		response.error = {
			code = "RUNTIME_LOCKED",
			message = "Cannot edit the project while the game is running — call stop_test first.",
		}
		return response
	end

	local recordingId: string? = nil
	if MUTATING[env.tool] then
		recordingId = ChangeHistoryService:TryBeginRecording("Claude: " .. env.tool)
	end

	local ok, result = pcall(handler, env.args, env)

	if recordingId then
		local op = if ok and not env.dryRun
			then Enum.FinishRecordingOperation.Commit
			else Enum.FinishRecordingOperation.Cancel
		pcall(function()
			ChangeHistoryService:FinishRecording(recordingId :: string, op)
		end)
	end

	if ok then
		response.ok = true
		response.result = result
	else
		response.ok = false
		if type(result) == "table" and (result :: any).code then
			response.error = result
		else
			response.error = { code = "LUAU_ERROR", message = tostring(result) }
		end
	end
	return response
end

return Dispatcher
