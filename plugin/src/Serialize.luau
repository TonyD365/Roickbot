-- Roblox 值 <-> JSON 友好值的双向转换。

local Safety = require(script.Parent.Safety)

local Serialize = {}

-- 把一个 Roblox 值转成可 JSON 编码的形式。
function Serialize.toJson(value: any): any
	local t = typeof(value)
	if t == "Vector3" then
		return { value.X, value.Y, value.Z }
	elseif t == "Vector2" then
		return { value.X, value.Y }
	elseif t == "Color3" then
		return { math.round(value.R * 255), math.round(value.G * 255), math.round(value.B * 255) }
	elseif t == "CFrame" then
		local rx, ry, rz = value:ToEulerAnglesXYZ()
		return {
			position = { value.X, value.Y, value.Z },
			orientation = { math.deg(rx), math.deg(ry), math.deg(rz) },
		}
	elseif t == "EnumItem" then
		return tostring(value.Name)
	elseif t == "BrickColor" then
		return value.Name
	elseif t == "UDim" then
		return { scale = value.Scale, offset = value.Offset }
	elseif t == "UDim2" then
		return {
			{ scale = value.X.Scale, offset = value.X.Offset },
			{ scale = value.Y.Scale, offset = value.Y.Offset },
		}
	elseif t == "NumberRange" then
		return { value.Min, value.Max }
	elseif t == "Instance" then
		return Safety.pathOf(value)
	elseif t == "number" or t == "string" or t == "boolean" then
		return value
	elseif t == "nil" then
		return nil
	else
		return tostring(value)
	end
end

local function num(v: any, idx: number, key: string, default: number): number
	if type(v) == "table" then
		if v[idx] ~= nil then
			return v[idx]
		end
		if v[key] ~= nil then
			return v[key]
		end
	end
	return default
end

-- 把 JSON 值按目标属性的当前类型转回 Roblox 值。
function Serialize.fromJson(raw: any, current: any): any
	local t = typeof(current)
	if t == "Vector3" then
		return Vector3.new(num(raw, 1, "x", 0), num(raw, 2, "y", 0), num(raw, 3, "z", 0))
	elseif t == "Vector2" then
		return Vector2.new(num(raw, 1, "x", 0), num(raw, 2, "y", 0))
	elseif t == "Color3" then
		if type(raw) == "table" then
			return Color3.fromRGB(raw[1] or 0, raw[2] or 0, raw[3] or 0)
		end
		return current
	elseif t == "CFrame" then
		if type(raw) == "table" and raw.position then
			local p = raw.position
			local cf = CFrame.new(p[1] or 0, p[2] or 0, p[3] or 0)
			if raw.orientation then
				local o = raw.orientation
				cf = cf
					* CFrame.Angles(math.rad(o[1] or 0), math.rad(o[2] or 0), math.rad(o[3] or 0))
			end
			return cf
		end
		return current
	elseif t == "EnumItem" then
		local enumType = current.EnumType
		if type(raw) == "string" then
			return (enumType :: any)[raw]
		elseif type(raw) == "number" then
			for _, item in ipairs(enumType:GetEnumItems()) do
				if item.Value == raw then
					return item
				end
			end
		end
		return current
	elseif t == "BrickColor" then
		return BrickColor.new(raw)
	elseif t == "UDim" then
		return UDim.new(num(raw, 1, "scale", 0), num(raw, 2, "offset", 0))
	elseif t == "UDim2" then
		if type(raw) == "table" and raw[1] then
			local x, y = raw[1], raw[2]
			return UDim2.new(x.scale or x[1] or 0, x.offset or x[2] or 0, y.scale or y[1] or 0, y.offset or y[2] or 0)
		end
		return current
	elseif t == "number" or t == "string" or t == "boolean" then
		return raw
	elseif t == "Instance" then
		return Safety.resolve(raw)
	else
		return raw
	end
end

return Serialize
