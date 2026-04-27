const mongoose = require("mongoose");

const classroomSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3}$/,
    },
    subject: {
      type: String,
      default: "",
      trim: true,
    },
    timing: {
      type: String,
      default: "",
      trim: true,
    },
    capacity: {
      type: String,
      default: "",
      trim: true,
    },
    info: {
      type: String,
      default: "",
      trim: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    studentAssignments: {
      type: Map,
      of: Number,
      default: new Map(),
    },
    studentPositions: {
      type: Map,
      of: {
        x: Number,
        z: Number,
      },
      default: new Map(),
    },
    teacherPositions: {
      type: Map,
      of: {
        x: Number,
        z: Number,
      },
      default: new Map(),
    },    blackboardStrokes: {
      type: Array,
      default: [],
      description: "Array of drawing strokes for the whiteboard",
    },  },
  { timestamps: true }
);

module.exports = mongoose.model("Classroom", classroomSchema);
