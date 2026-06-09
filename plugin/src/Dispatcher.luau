-- 命令分发：把 tool 名映射到 handler，并用 ChangeHistoryService 包裹变更（支持撤销 + dryRun 回滚）。

local ChangeHistoryService = game:GetService("ChangeHistoryService")

local tree = require(script.Parent.handlers.tree)
local instances = require(script.Parent.handlers.instances)
local properties = require(script.Parent.handlers.properties)
local scripts = require(script.Parent.handlers.scripts)
local selection = require(script.Parent.handlers.selection)
local run = require(script.Parent.handlers.run)
local runLuau = require(script.Parent.handlers.runLuau)
local graphics = require(script.Parent.handlers.graphics)

local Dispatcher = {}

-- 工具名 -> handler 函数。
local handlers: { [string]: (any, any) -> any } = {
	-- 读取
	get_tree = tree.get_tree,
	get_children = tree.get_children,
	view_elements = tree.view_elements,
	get_properties = properties.get_properties,
	get_script_source = scripts.get_script_source,
	get_selection = selection.get_selection,
	get_run_state = run.get_run_state,
	-- 变更
	set_properties = properties.set_properties,
	create_instance = instances.create_instance,
	delete_instance = instances.delete_instance,
	clone_instance = instances.clone_instance,
	reparent_instance = instances.reparent_instance,
	set_script_source = scripts.set_script_source,
	set_selection = selection.set_selection,
	run_luau = runLuau.run_luau,
	-- 运行
	run_simulation = run.run_simulation,
	stop_simulation = run.stop_simulation,
	pause_simulation = run.pause_simulation,
	-- 做图（Phase 2）
	build_parts = graphics.build_parts,
	set_appearance = graphics.set_appearance,
	edit_terrain = graphics.edit_terrain,
	set_lighting = graphics.set_lighting,
	insert_decal = graphics.insert_decal,
	insert_model = graphics.insert_model,
	build_gui = graphics.build_gui,
}

-- 需要包 ChangeHistory 录制（可撤销 / dryRun 可回滚）的工具。
local MUTATING: { [string]: boolean } = {
	set_properties = true,
	create_instance = true,
	delete_instance = true,
	clone_instance = true,
	reparent_instance = true,
	set_script_source = true,
	run_luau = true,
	build_parts = true,
	set_appearance = true,
	edit_terrain = true,
	set_lighting = true,
	insert_decal = true,
	insert_model = true,
	build_gui = true,
}

function Dispatcher.dispatch(env: any): any
	local response: { [string]: any } = { id = env.id }
	local handler = handlers[env.tool]
	if not handler then
		response.ok = false
		response.error = { code = "UNKNOWN_TOOL", message = "No handler for tool: " .. tostring(env.tool) }
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
