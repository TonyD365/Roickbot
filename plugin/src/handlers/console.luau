-- 读取 Studio 控制台/Output 日志（print / warning / error）。

local LogService = game:GetService("LogService")

local M = {}

local TYPE_NAMES: { [Enum.MessageType]: string } = {
	[Enum.MessageType.MessageOutput] = "Output",
	[Enum.MessageType.MessageInfo] = "Info",
	[Enum.MessageType.MessageWarning] = "Warning",
	[Enum.MessageType.MessageError] = "Error",
}

function M.get_console_output(args: any)
	local count = (args and args.count) or 100
	local filter = args and args.includeTypes -- 形如 {"Error","Warning"}
	local order = (args and args.order) or "newest" -- 默认最新在前（调试最常用）。

	local history = LogService:GetLogHistory()
	local out = {}
	for _, entry in ipairs(history) do
		local typeName = TYPE_NAMES[entry.messageType] or tostring(entry.messageType)
		if not filter or table.find(filter, typeName) then
			table.insert(out, {
				message = entry.message,
				type = typeName,
				timestamp = entry.timestamp,
			})
		end
	end

	-- 只保留最近 count 条（history 是按时间正序，取末尾即最新）。
	if #out > count then
		local trimmed = {}
		for i = #out - count + 1, #out do
			table.insert(trimmed, out[i])
		end
		out = trimmed
	end

	-- 默认把最新的放在最前，方便直接看到最近的报错。
	if order == "newest" then
		local rev = {}
		for i = #out, 1, -1 do
			table.insert(rev, out[i])
		end
		out = rev
	end

	return { count = #out, order = order, messages = out }
end

return M
